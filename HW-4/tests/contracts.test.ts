import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import * as z from 'zod';
import { ERROR_CODES, TOOLS, toolErrorSchema } from '../src/contracts.ts';

const doc = readFileSync(new URL('../docs/contract.md', import.meta.url), 'utf8');

function docSection(toolName: string): string {
    const start = doc.indexOf(`## \`${toolName}\``);
    assert.notEqual(start, -1, `docs/contract.md has no section for ${toolName}`);
    const next = doc.indexOf('\n## ', start + 1);
    return doc.slice(start, next === -1 ? undefined : next);
}

/** Collects every property name and string enum value from a JSON Schema. */
function schemaTokens(schema: unknown, tokens = new Set<string>()): Set<string> {
    if (Array.isArray(schema)) schema.forEach(item => schemaTokens(item, tokens));
    else if (schema && typeof schema === 'object') {
        for (const [key, value] of Object.entries(schema)) {
            if (key === 'properties' && value && typeof value === 'object') Object.keys(value).forEach(name => tokens.add(name));
            if (key === 'enum' && Array.isArray(value)) value.filter(v => typeof v === 'string').forEach(v => tokens.add(v));
            schemaTokens(value, tokens);
        }
    }
    return tokens;
}

describe('tool contracts', () => {
    test('declares exactly four uniquely named tools', () => {
        const names = Object.values(TOOLS).map(tool => tool.name);
        assert.deepEqual(names, ['search_code', 'get_file_outline', 'lookup_docs', 'run_check']);
        for (const tool of Object.values(TOOLS)) assert.ok(tool.description.length > 40, `${tool.name} needs a useful description`);
    });

    test('input and output schemas are strict JSON objects', () => {
        for (const tool of Object.values(TOOLS)) {
            for (const [io, schema] of [['input', tool.inputSchema], ['output', tool.outputSchema]] as const) {
                const json = z.toJSONSchema(schema, { io }) as { type?: string; additionalProperties?: unknown };
                assert.equal(json.type, 'object', `${tool.name} ${io}`);
                assert.equal(json.additionalProperties, false, `${tool.name} ${io} must reject unknown fields`);
            }
        }
    });

    for (const tool of Object.values(TOOLS)) {
        test(`docs/contract.md documents every field of ${tool.name}`, () => {
            const section = docSection(tool.name);
            const tokens = new Set([
                ...schemaTokens(z.toJSONSchema(tool.inputSchema, { io: 'input' })),
                ...schemaTokens(z.toJSONSchema(tool.outputSchema, { io: 'output' }))
            ]);
            const missing = [...tokens].filter(token => !section.includes(`\`${token}\``) && !section.includes(`\`${token}[]\``));
            assert.deepEqual(missing, [], `undocumented in ${tool.name} section`);
        });
    }

    test('docs/contract.md lists every error code and the error payload shape', () => {
        for (const code of ERROR_CODES) assert.ok(doc.includes(`\`${code}\``), `${code} is not documented`);
        assert.ok(doc.includes('{ error: { code, message } }'));
        assert.ok(toolErrorSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success);
        assert.ok(!toolErrorSchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success);
    });
});
