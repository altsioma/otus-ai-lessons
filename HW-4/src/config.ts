import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';

/** HW-4 directory (parent of src/ and dist/). Relative paths in env vars resolve against it. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const optionalString = z.preprocess(value => (value === '' ? undefined : value), z.string().optional());

const envSchema = z.object({
    PROJECT_ROOT: optionalString,
    DOCS_ROOT: optionalString,
    LOG_FILE: optionalString,
    CHECK_TIMEOUT_MS: z.preprocess(
        value => (value === '' || value === undefined ? undefined : Number(value)),
        z.number().int().min(1000).max(300_000).default(60_000)
    )
});

export interface AppConfig {
    /** Real path of the directory that search_code / get_file_outline / run_check may access. */
    projectRoot: string;
    /** Real path of the Markdown knowledge base for lookup_docs. */
    docsRoot: string;
    /** Optional log file (absolute). */
    logFile: string | undefined;
    checkTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
    const { PROJECT_ROOT, DOCS_ROOT, LOG_FILE, CHECK_TIMEOUT_MS } = parsed.data;
    return {
        projectRoot: resolveDirectory(PROJECT_ROOT ?? 'demo-project', 'PROJECT_ROOT'),
        docsRoot: resolveDirectory(DOCS_ROOT ?? 'docs-kb', 'DOCS_ROOT'),
        logFile: LOG_FILE === undefined ? undefined : path.resolve(PACKAGE_ROOT, LOG_FILE),
        checkTimeoutMs: CHECK_TIMEOUT_MS
    };
}

function resolveDirectory(value: string, name: string): string {
    const absolute = path.resolve(PACKAGE_ROOT, value);
    let real: string;
    try {
        real = realpathSync(absolute);
    } catch {
        throw new Error(`${name} does not exist: ${absolute}`);
    }
    if (!statSync(real).isDirectory()) throw new Error(`${name} is not a directory: ${absolute}`);
    return real;
}
