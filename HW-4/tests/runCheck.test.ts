import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runCheckInput, runCheckOutput } from '../src/contracts.ts';
import { ToolError } from '../src/errors.ts';
import { CHECKS, runCheck } from '../src/tools/runCheck.ts';
import type { RunCheckInput } from '../src/contracts.ts';
import { demoContext } from './helpers.ts';

const ctx = demoContext();
const fails = (code: string) => (error: unknown) => error instanceof ToolError && error.code === code;

describe('run_check', () => {
    test('runs the demo tests', async () => {
        const result = runCheckOutput.parse(await runCheck({ check: 'test' }, ctx));
        assert.equal(result.passed, true);
        assert.equal(result.exitCode, 0);
        assert.equal(result.summary.testsFailed, 0);
        assert.ok((result.summary.testsPassed ?? 0) >= 8);
        assert.equal(result.summary.typeErrors, null);
    });

    test('runs the demo typecheck', async () => {
        const result = runCheckOutput.parse(await runCheck({ check: 'typecheck' }, ctx));
        assert.equal(result.passed, true);
        assert.equal(result.summary.typeErrors, 0);
    });

    test('stops a check that exceeds the timeout', async () => {
        await assert.rejects(runCheck({ check: 'test' }, { ...ctx, checkTimeoutMs: 1 }), fails('TIMEOUT'));
    });

    test('refuses anything outside the allow list', async () => {
        for (const check of ['rm -rf /', 'npm install', '__proto__', 'constructor', 'toString']) {
            await assert.rejects(runCheck({ check } as unknown as RunCheckInput, ctx), fails('CHECK_NOT_ALLOWED'));
        }
    });

    test('schema accepts only known checks and no extra arguments', () => {
        assert.equal(runCheckInput.safeParse({ check: 'test' }).success, true);
        assert.equal(runCheckInput.safeParse({ check: 'bash' }).success, false);
        assert.equal(runCheckInput.safeParse({ check: 'test', args: ['--inspect'] }).success, false);
        assert.equal(runCheckInput.safeParse({ check: 'test; rm -rf /' }).success, false);
    });

    test('allow list is frozen and uses fixed argv without a shell', () => {
        assert.ok(Object.isFrozen(CHECKS));
        assert.deepEqual(Object.keys(CHECKS).sort(), ['test', 'typecheck']);
        for (const spec of Object.values(CHECKS)) assert.equal(spec.file, process.execPath);
    });
});
