import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { isDenied, readTextFileSafe, resolveSafePath, walkFiles } from '../src/security/sandbox.ts';
import { ToolError } from '../src/errors.ts';
import { ENV_SECRET, hostileFixture, OUTSIDE_SECRET } from './helpers.ts';

const fx = hostileFixture();
after(fx.cleanup);

async function rejectsWith(promise: Promise<unknown>, code: string, requested = '') {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof ToolError, `expected ToolError, got ${String(error)}`);
        assert.equal(error.code, code);
        assert.ok(!error.message.includes(OUTSIDE_SECRET) && !error.message.includes(ENV_SECRET), 'message must not leak secrets');
        // Messages may quote the caller's own input, but never reveal where a symlink really points.
        if (!requested.includes(fx.outside)) assert.ok(!error.message.includes(fx.outside), 'message must not reveal outside paths');
        return true;
    });
}

describe('resolveSafePath', () => {
    test('accepts paths inside the root and normalizes them', async () => {
        assert.deepEqual(await resolveSafePath(fx.root, 'src/../src/app.ts'), { absolute: `${fx.root}/src/app.ts`, relative: 'src/app.ts' });
        assert.equal((await resolveSafePath(fx.root, '.')).relative, '.');
    });

    test('rejects path traversal with ../', async () => {
        await rejectsWith(resolveSafePath(fx.root, '../outside/secret.ts'), 'PATH_OUTSIDE_ROOT');
        await rejectsWith(resolveSafePath(fx.root, 'src/../../outside/secret.ts'), 'PATH_OUTSIDE_ROOT');
        await rejectsWith(resolveSafePath(fx.root, '..'), 'PATH_OUTSIDE_ROOT');
    });

    test('rejects absolute paths and NUL bytes', async () => {
        await rejectsWith(resolveSafePath(fx.root, `${fx.outside}/secret.ts`), 'PATH_OUTSIDE_ROOT', `${fx.outside}/secret.ts`);
        await rejectsWith(resolveSafePath(fx.root, '/etc/passwd'), 'PATH_OUTSIDE_ROOT');
        await rejectsWith(resolveSafePath(fx.root, 'src/app.ts\0.md'), 'INVALID_INPUT');
    });

    test('rejects symlinks that lead outside the root', async () => {
        await rejectsWith(resolveSafePath(fx.root, 'src/link-out.ts'), 'PATH_OUTSIDE_ROOT');
        await rejectsWith(resolveSafePath(fx.root, 'linked-outside/secret.ts'), 'PATH_OUTSIDE_ROOT');
    });

    test('follows symlinks that stay inside the root', async () => {
        assert.equal((await resolveSafePath(fx.root, 'src/link-in.ts')).relative, 'src/app.ts');
    });

    test('denies secrets, VCS and dependency folders, including via symlink', async () => {
        for (const denied of ['.env', 'config/.env.local', 'keys/server.pem', 'node_modules/pkg/index.ts', '.git/config', 'src/env-link.ts']) {
            await rejectsWith(resolveSafePath(fx.root, denied), 'ACCESS_DENIED');
        }
    });

    test('reports missing files as NOT_FOUND', async () => {
        await rejectsWith(resolveSafePath(fx.root, 'src/missing.ts'), 'NOT_FOUND');
    });
});

describe('isDenied', () => {
    test('matches policy entries and allows .env.example', () => {
        assert.equal(isDenied('.env'), true);
        assert.equal(isDenied('a/.env.production'), true);
        assert.equal(isDenied('id_rsa'), true);
        assert.equal(isDenied('.npmrc'), true);
        assert.equal(isDenied('config/secrets.yaml'), true);
        assert.equal(isDenied('src/secret.ts'), false);
        assert.equal(isDenied('.env.example'), false);
        assert.equal(isDenied('src/environment.ts'), false);
    });
});

describe('readTextFileSafe', () => {
    test('reads an allowed file', async () => {
        const file = await readTextFileSafe(fx.root, 'src/app.ts');
        assert.match(file.text, /export function greet/);
    });

    test('enforces the size limit', async () => {
        await rejectsWith(readTextFileSafe(fx.root, 'src/big.ts'), 'FILE_TOO_LARGE');
        await rejectsWith(readTextFileSafe(fx.root, 'src/app.ts', 10), 'FILE_TOO_LARGE');
    });

    test('rejects binary files and directories', async () => {
        await rejectsWith(readTextFileSafe(fx.root, 'src/binary.ts'), 'UNSUPPORTED_FILE_TYPE');
        await rejectsWith(readTextFileSafe(fx.root, 'src'), 'NOT_A_FILE');
    });
});

describe('walkFiles', () => {
    test('skips denied entries and symlinks leaving the root', async () => {
        const { files, truncated } = await walkFiles(fx.root, '.', { extensions: ['.ts', '.md', '.txt'] });
        const listed = files.map(file => file.relative);
        assert.equal(truncated, false);
        assert.ok(listed.includes('src/app.ts'));
        assert.ok(listed.includes('docs/guide.md'));
        for (const forbidden of ['.env', 'config/.env.local', 'node_modules/pkg/index.ts', '.git/config']) {
            assert.ok(!listed.includes(forbidden), `${forbidden} must be skipped`);
        }
        assert.ok(!listed.some(file => file.includes('secret') || file.includes('link-out') || file.includes('linked-outside')));
    });

    test('stops at maxFiles', async () => {
        const result = await walkFiles(fx.root, '.', { extensions: ['.ts'], maxFiles: 1 });
        assert.equal(result.files.length, 1);
        assert.equal(result.truncated, true);
    });
});
