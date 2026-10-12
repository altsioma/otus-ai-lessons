import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { CheckName, RunCheckInput, RunCheckOutput } from '../contracts.ts';
import { ToolError } from '../errors.ts';
import type { ToolContext } from './context.ts';

const MAX_OUTPUT_CHARS = 4000;
const MAX_CAPTURE_BYTES = 1024 * 1024;

interface CheckSpec {
    /** Executable and arguments are fixed here; nothing from the caller reaches argv. */
    file: string;
    args: readonly string[];
    display: string;
    summarize: (output: string) => RunCheckOutput['summary'];
}

const tscPath = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const countMatch = (output: string, pattern: RegExp): number | null => {
    const match = pattern.exec(output);
    return match?.[1] === undefined ? null : Number(match[1]);
};

export const CHECKS: Readonly<Record<CheckName, CheckSpec>> = Object.freeze({
    test: {
        file: process.execPath,
        args: ['--test', '--test-reporter=tap', 'tests/**/*.test.ts'],
        display: "node --test --test-reporter=tap 'tests/**/*.test.ts'",
        summarize: output => ({
            testsPassed: countMatch(output, /^# pass (\d+)$/m),
            testsFailed: countMatch(output, /^# fail (\d+)$/m),
            typeErrors: null
        })
    },
    typecheck: {
        file: process.execPath,
        args: [tscPath, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
        display: 'tsc --noEmit --pretty false -p tsconfig.json',
        summarize: output => ({
            testsPassed: null,
            testsFailed: null,
            typeErrors: (output.match(/error TS\d+:/g) ?? []).length
        })
    }
});

// Minimal environment for child processes: no inherited tokens or credentials.
function childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { NO_COLOR: '1', FORCE_COLOR: '0', NODE_ENV: 'test' };
    for (const key of ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT']) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

export async function runCheck(input: RunCheckInput, ctx: ToolContext): Promise<RunCheckOutput> {
    // Schema validation already restricts `check`; this guards direct calls and prototype keys.
    if (!Object.hasOwn(CHECKS, input.check)) {
        throw new ToolError('CHECK_NOT_ALLOWED', `Check "${String(input.check)}" is not in the allow list: ${Object.keys(CHECKS).join(', ')}`);
    }
    const spec = CHECKS[input.check];
    const started = performance.now();
    const { exitCode, output } = await execute(spec, ctx);
    const outputTruncated = output.length > MAX_OUTPUT_CHARS;

    return {
        check: input.check,
        command: spec.display,
        exitCode,
        passed: exitCode === 0,
        durationMs: Math.round(performance.now() - started),
        summary: spec.summarize(output),
        output: outputTruncated ? output.slice(-MAX_OUTPUT_CHARS) : output,
        outputTruncated
    };
}

function execute(spec: CheckSpec, ctx: ToolContext): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(spec.file, spec.args, {
            cwd: ctx.projectRoot,
            env: childEnv(),
            shell: false,
            detached: true, // own process group, so a timeout kills test-runner subprocesses too
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });

        const chunks: Buffer[] = [];
        let captured = 0;
        const collect = (chunk: Buffer) => {
            chunks.push(chunk);
            captured += chunk.length;
            while (captured > MAX_CAPTURE_BYTES && chunks.length > 1) captured -= chunks.shift()!.length;
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killGroup(child.pid);
        }, ctx.checkTimeoutMs);

        child.on('error', () => {
            clearTimeout(timer);
            reject(new ToolError('EXECUTION_FAILED', `Could not start check "${spec.display}"`));
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new ToolError('TIMEOUT', `Check "${spec.display}" exceeded ${ctx.checkTimeoutMs} ms and was stopped`));
                return;
            }
            if (code === null) {
                reject(new ToolError('EXECUTION_FAILED', `Check "${spec.display}" was terminated by signal ${signal ?? 'unknown'}`));
                return;
            }
            resolve({ exitCode: code, output: Buffer.concat(chunks).toString('utf8') });
        });
    });
}

function killGroup(pid: number | undefined): void {
    if (pid === undefined) return;
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already exited
        }
    }
}
