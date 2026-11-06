import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { type LogEntry, Logger } from '../src/logger.ts';
import type { ToolContext } from '../src/tools/context.ts';

export const OUTSIDE_SECRET = 'TOP_SECRET_OUTSIDE_VALUE';
export const ENV_SECRET = 'ENV_FILE_SECRET_VALUE';

/** Context pointing at the real demo-project and docs-kb. */
export function demoContext(overrides: Partial<ToolContext> = {}): ToolContext {
    const config = loadConfig({});
    return { projectRoot: config.projectRoot, docsRoot: config.docsRoot, checkTimeoutMs: 60_000, ...overrides };
}

/**
 * Temporary sandbox with hostile fixtures:
 *   <base>/root      — the allowed root
 *   <base>/outside   — must never be readable
 */
export function hostileFixture() {
    const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'dev-helper-')));
    const root = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    const write = (file: string, content: string | Buffer) => {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
    };

    write(path.join(outside, 'secret.ts'), `export const leaked = '${OUTSIDE_SECRET}';\n`);
    write(path.join(root, 'src/app.ts'), 'export function greet(name: string): string {\n    return `hi ${name}`; // needle\n}\n');
    write(path.join(root, 'src/big.ts'), `// needle\n${'x'.repeat(300 * 1024)}\n`);
    write(path.join(root, 'src/binary.ts'), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0x01]));
    write(path.join(root, 'notes.txt'), 'needle in a text file\n');
    write(path.join(root, '.env'), `SECRET=${ENV_SECRET} needle\n`);
    write(path.join(root, 'config/.env.local'), `SECRET=${ENV_SECRET} needle\n`);
    write(path.join(root, '.env.example'), 'SECRET=\n');
    write(path.join(root, 'keys/server.pem'), `-----BEGIN ${'PRIVATE'} KEY-----\nneedle\n`);
    write(path.join(root, 'node_modules/pkg/index.ts'), 'export const needle = 1;\n');
    write(path.join(root, '.git/config'), 'needle\n');
    write(path.join(root, 'docs/guide.md'), '# Guide\n\nneedle\n');

    symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src/link-out.ts'));
    symlinkSync(outside, path.join(root, 'linked-outside'));
    symlinkSync(path.join(root, 'src/app.ts'), path.join(root, 'src/link-in.ts'));
    symlinkSync(path.join(root, '.env'), path.join(root, 'src/env-link.ts'));

    const ctx: ToolContext = { projectRoot: root, docsRoot: path.join(root, 'docs'), checkTimeoutMs: 60_000 };
    return { base, root, outside, ctx, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** Logger that keeps entries in memory instead of writing to stderr. */
export function captureLogger(): { logger: Logger; entries: LogEntry[] } {
    const entries: LogEntry[] = [];
    return { logger: new Logger({ stderr: false, sink: entry => entries.push(entry) }), entries };
}
