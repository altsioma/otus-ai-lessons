import path from 'node:path';
import ts from 'typescript';
import type { GetFileOutlineInput, GetFileOutlineOutput } from '../contracts.ts';
import { ToolError } from '../errors.ts';
import { readTextFileSafe, resolveSafePath } from '../security/sandbox.ts';
import type { ToolContext } from './context.ts';

type ExportItem = GetFileOutlineOutput['exports'][number];
type Member = ExportItem['members'][number];

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
    '.ts': ts.ScriptKind.TS,
    '.mts': ts.ScriptKind.TS,
    '.cts': ts.ScriptKind.TS,
    '.tsx': ts.ScriptKind.TSX
};
const MAX_SIGNATURE = 300;

/** Lists the public exports of a TypeScript file using the compiler's AST (no type checking). */
export async function getFileOutline(input: GetFileOutlineInput, ctx: ToolContext): Promise<GetFileOutlineOutput> {
    const target = await resolveSafePath(ctx.projectRoot, input.path);
    const scriptKind = SCRIPT_KINDS[path.extname(target.relative).toLowerCase()];
    if (scriptKind === undefined) {
        throw new ToolError('UNSUPPORTED_FILE_TYPE', `"${input.path}" is not a TypeScript file (.ts, .tsx, .mts, .cts)`);
    }
    const file = await readTextFileSafe(ctx.projectRoot, target.relative);
    const sourceFile = ts.createSourceFile(file.relative, file.text, ts.ScriptTarget.Latest, true, scriptKind);
    const exports = new OutlineBuilder(sourceFile).build();
    return { file: file.relative, exports, totalExports: exports.length };
}

class OutlineBuilder {
    readonly #sf: ts.SourceFile;
    readonly #printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

    constructor(sourceFile: ts.SourceFile) {
        this.#sf = sourceFile;
    }

    build(): ExportItem[] {
        const items: ExportItem[] = [];
        for (const statement of this.#sf.statements) {
            if (ts.isExportDeclaration(statement)) items.push(...this.#fromExportDeclaration(statement));
            else if (ts.isExportAssignment(statement)) items.push(this.#fromExportAssignment(statement));
            else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) items.push(...this.#describe(statement, statement));
        }
        return items;
    }

    /** Describes a declaration statement; `anchor` gives the reported line (the export site). */
    #describe(statement: ts.Statement, anchor: ts.Node, exportedName?: string): ExportItem[] {
        const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
        const item = (name: string, kind: ExportItem['kind'], signature: string, doc: ts.Node, members: Member[] = []): ExportItem => ({
            name: exportedName ?? (isDefault ? 'default' : name),
            kind,
            line: this.#line(anchor),
            signature: clip(withoutExportKeywords(signature)),
            isDefault: isDefault || exportedName === 'default',
            jsDoc: jsDocOf(doc),
            members
        });
        const f = ts.factory;

        if (ts.isFunctionDeclaration(statement)) {
            const header = f.updateFunctionDeclaration(
                statement, statement.modifiers, statement.asteriskToken, statement.name,
                statement.typeParameters, statement.parameters, statement.type, undefined
            );
            return [item(statement.name?.text ?? 'default', 'function', this.#print(header), statement)];
        }
        if (ts.isClassDeclaration(statement)) {
            const header = f.updateClassDeclaration(
                statement, statement.modifiers, statement.name, statement.typeParameters, statement.heritageClauses, []
            );
            return [item(statement.name?.text ?? 'default', 'class', stripBody(this.#print(header)), statement, this.#classMembers(statement))];
        }
        if (ts.isInterfaceDeclaration(statement)) {
            const header = f.updateInterfaceDeclaration(
                statement, statement.modifiers, statement.name, statement.typeParameters, statement.heritageClauses, []
            );
            return [item(statement.name.text, 'interface', stripBody(this.#print(header)), statement, this.#interfaceMembers(statement))];
        }
        if (ts.isTypeAliasDeclaration(statement)) return [item(statement.name.text, 'type', this.#print(statement), statement)];
        if (ts.isEnumDeclaration(statement)) return [item(statement.name.text, 'enum', this.#print(statement), statement)];
        if (ts.isModuleDeclaration(statement)) {
            return [item(statement.name.getText(this.#sf), 'namespace', `namespace ${statement.name.getText(this.#sf)}`, statement)];
        }
        if (ts.isVariableStatement(statement)) {
            const keyword = declarationKeyword(statement.declarationList);
            return statement.declarationList.declarations
                .filter(declaration => ts.isIdentifier(declaration.name))
                .map(declaration => {
                    const { kind, signature } = this.#variableSignature(keyword, declaration);
                    const doc = jsDocOf(declaration) === null ? statement : declaration;
                    return item((declaration.name as ts.Identifier).text, kind, signature, doc);
                });
        }
        return [];
    }

    #variableSignature(keyword: string, declaration: ts.VariableDeclaration): { kind: ExportItem['kind']; signature: string } {
        const name = declaration.name.getText(this.#sf);
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            const params = init.parameters.map(parameter => parameter.getText(this.#sf)).join(', ');
            const typeParams = init.typeParameters ? `<${init.typeParameters.map(p => p.getText(this.#sf)).join(', ')}>` : '';
            const returns = init.type ? `: ${init.type.getText(this.#sf)}` : '';
            return { kind: 'function', signature: `${keyword} ${name} = ${typeParams}(${params})${returns} => …` };
        }
        const annotation = declaration.type ? `: ${declaration.type.getText(this.#sf)}` : '';
        const value = init ? ` = ${clip(collapse(init.getText(this.#sf)), 80)}` : '';
        return { kind: 'variable', signature: `${keyword} ${name}${annotation}${value}` };
    }

    #classMembers(node: ts.ClassDeclaration): Member[] {
        const f = ts.factory;
        const members: Member[] = [];
        for (const member of node.members) {
            if (hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) continue;
            if (member.name && ts.isPrivateIdentifier(member.name)) continue;
            const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
            const add = (kind: Member['kind'], name: string, printed: ts.Node) =>
                members.push({ name, kind, line: this.#line(member), signature: clip(this.#print(printed)), isStatic });

            if (ts.isConstructorDeclaration(member)) {
                add('constructor', 'constructor', f.updateConstructorDeclaration(member, member.modifiers, member.parameters, undefined));
            } else if (ts.isMethodDeclaration(member)) {
                add('method', member.name.getText(this.#sf), f.updateMethodDeclaration(
                    member, member.modifiers, member.asteriskToken, member.name, member.questionToken,
                    member.typeParameters, member.parameters, member.type, undefined
                ));
            } else if (ts.isPropertyDeclaration(member)) {
                add('property', member.name.getText(this.#sf), f.updatePropertyDeclaration(
                    member, member.modifiers, member.name, member.questionToken ?? member.exclamationToken, member.type, undefined
                ));
            } else if (ts.isGetAccessorDeclaration(member)) {
                add('getter', member.name.getText(this.#sf), f.updateGetAccessorDeclaration(
                    member, member.modifiers, member.name, member.parameters, member.type, undefined
                ));
            } else if (ts.isSetAccessorDeclaration(member)) {
                add('setter', member.name.getText(this.#sf), f.updateSetAccessorDeclaration(
                    member, member.modifiers, member.name, member.parameters, undefined
                ));
            }
        }
        return members;
    }

    #interfaceMembers(node: ts.InterfaceDeclaration): Member[] {
        return node.members.flatMap((member): Member[] => {
            if (!(ts.isPropertySignature(member) || ts.isMethodSignature(member)) || !member.name) return [];
            return [{
                name: member.name.getText(this.#sf),
                kind: ts.isMethodSignature(member) ? 'method' : 'property',
                line: this.#line(member),
                signature: clip(this.#print(member)),
                isStatic: false
            }];
        });
    }

    #fromExportDeclaration(node: ts.ExportDeclaration): ExportItem[] {
        const reExport = (name: string): ExportItem => ({
            name,
            kind: 're-export',
            line: this.#line(node),
            signature: clip(this.#print(node)),
            isDefault: name === 'default',
            jsDoc: jsDocOf(node),
            members: []
        });

        if (!node.exportClause) return [reExport('*')]; // export * from '...'
        if (ts.isNamespaceExport(node.exportClause)) return [reExport(node.exportClause.name.getText(this.#sf))];

        return node.exportClause.elements.flatMap(specifier => {
            const exportedName = specifier.name.getText(this.#sf);
            if (node.moduleSpecifier) return [reExport(exportedName)];
            // export { local as exported }: describe the local declaration when it is in this file.
            const localName = (specifier.propertyName ?? specifier.name).getText(this.#sf);
            const local = this.#findLocal(localName);
            return local ? this.#describe(local, specifier, exportedName) : [reExport(exportedName)];
        });
    }

    #fromExportAssignment(node: ts.ExportAssignment): ExportItem {
        return {
            name: node.isExportEquals ? 'export=' : 'default',
            kind: 'default',
            line: this.#line(node),
            signature: clip(this.#print(node)),
            isDefault: true,
            jsDoc: jsDocOf(node),
            members: []
        };
    }

    #findLocal(name: string): ts.Statement | undefined {
        return this.#sf.statements.find(statement => {
            if (ts.isVariableStatement(statement)) {
                return statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name);
            }
            const declared = (statement as ts.Statement & { name?: ts.Node }).name;
            return (
                (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
                    ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
                declared !== undefined && ts.isIdentifier(declared) && declared.text === name
            );
        });
    }

    #line(node: ts.Node): number {
        return this.#sf.getLineAndCharacterOfPosition(node.getStart(this.#sf)).line + 1;
    }

    #print(node: ts.Node): string {
        return collapse(this.#printer.printNode(ts.EmitHint.Unspecified, node, this.#sf)).replace(/;$/, '');
    }
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === kind);
}

function declarationKeyword(list: ts.VariableDeclarationList): string {
    if (list.flags & ts.NodeFlags.Const) return 'const';
    if (list.flags & ts.NodeFlags.Let) return 'let';
    return 'var';
}

function jsDocOf(node: ts.Node): string | null {
    const doc = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
    const text = doc ? ts.getTextOfJSDocComment(doc.comment)?.trim() : undefined;
    return text ? text : null;
}

/** `kind` and `isDefault` already say how a symbol is exported, so signatures omit "export [default]". */
function withoutExportKeywords(signature: string): string {
    return signature.replace(/^export\s+(default\s+)?/, '');
}

function collapse(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function stripBody(text: string): string {
    return text.replace(/\s*\{\s*\}$/, '');
}

function clip(text: string, max: number = MAX_SIGNATURE): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
