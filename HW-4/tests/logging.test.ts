import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { toolErrorSchema } from '../src/contracts.ts';
import { ToolError } from '../src/errors.ts';
import { Logger } from '../src/logger.ts';
import { REDACTED, redact } from '../src/redact.ts';
import { withLogging } from '../src/withLogging.ts';
import { captureLogger } from './helpers.ts';

describe('withLogging', () => {
    test('logs a successful call and returns structured content', async () => {
        const { logger, entries } = captureLogger();
        const handler = withLogging('demo_tool', logger, async (input: { query: string }) => ({ echoed: input.query }));
        const result = await handler({ query: 'cart' });

        assert.deepEqual(result.structuredContent, { echoed: 'cart' });
        assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), { echoed: 'cart' });
        assert.equal(result.isError, undefined);

        assert.equal(entries.length, 1);
        const entry = entries[0]!;
        assert.equal(entry.event, 'tool_call');
        assert.equal(entry.tool, 'demo_tool');
        assert.deepEqual(entry.args, { query: 'cart' });
        assert.equal(entry.status, 'success');
        assert.equal(typeof entry.durationMs, 'number');
        assert.equal(typeof entry.callId, 'string');
        assert.equal(entry.errorCode, undefined);
    });

    test('logs a ToolError with its code and returns the documented error payload', async () => {
        const { logger, entries } = captureLogger();
        const handler = withLogging('demo_tool', logger, async (_: { path: string }) => {
            throw new ToolError('NOT_FOUND', '"x.ts" does not exist');
        });
        const result = await handler({ path: 'x.ts' });

        assert.equal(result.isError, true);
        assert.deepEqual(toolErrorSchema.parse(result.structuredContent), { error: { code: 'NOT_FOUND', message: '"x.ts" does not exist' } });
        assert.equal(entries[0]!.status, 'error');
        assert.equal(entries[0]!.errorCode, 'NOT_FOUND');
        assert.equal(entries[0]!.level, 'warn');
    });

    test('hides unexpected error details from the client but keeps them in the log', async () => {
        const { logger, entries } = captureLogger();
        const handler = withLogging('demo_tool', logger, async () => {
            throw new Error('ENOMEM at /private/internal/path');
        });
        const result = await handler({});
        const payload = toolErrorSchema.parse(result.structuredContent);
        assert.equal(payload.error.code, 'INTERNAL_ERROR');
        assert.ok(!payload.error.message.includes('/private/internal/path'));
        assert.equal(entries[0]!.level, 'error');
        assert.match(String(entries[0]!.cause), /ENOMEM/);
    });

    test('redacts sensitive arguments before logging', async () => {
        const { logger, entries } = captureLogger();
        const handler = withLogging('demo_tool', logger, async () => ({ ok: true }));
        const fakeKey = ['sk', 'ant', 'abcdefghijklmnopqrstuvwxyz'].join('-'); // built at runtime so secret scanners stay quiet
        await handler({ query: fakeKey, apiKey: 'plain', nested: { password: 'p', keep: 'visible' } });
        assert.deepEqual(entries[0]!.args, { query: REDACTED, apiKey: REDACTED, nested: { password: REDACTED, keep: 'visible' } });
    });
});

describe('redact', () => {
    test('bounds long strings, arrays and depth', () => {
        assert.match(String(redact('a'.repeat(500))), /…\(\+300 chars\)$/);
        assert.equal((redact(Array.from({ length: 30 }, (_, i) => i)) as unknown[]).length, 21);
        assert.equal(JSON.stringify(redact({ a: { b: { c: { d: { e: { f: 1 } } } } } })).includes('[TRUNCATED]'), true);
        assert.equal(redact(`-----BEGIN RSA ${'PRIVATE'} KEY-----`), REDACTED);
    });
});

describe('Logger', () => {
    test('writes JSON lines to the configured file', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'dev-helper-log-'));
        try {
            const file = path.join(dir, 'nested', 'server.log');
            const logger = new Logger({ file, stderr: false });
            logger.log('info', 'tool_call', { tool: 'search_code', token: 'secret-value' });
            const [line] = readFileSync(file, 'utf8').trim().split('\n');
            const entry = JSON.parse(line!);
            assert.equal(entry.tool, 'search_code');
            assert.equal(entry.token, REDACTED);
            assert.ok(entry.ts);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
