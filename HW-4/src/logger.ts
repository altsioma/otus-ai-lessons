import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { redact } from './redact.ts';

// Structured JSON-lines logger. Writes to stderr (never stdout: it carries MCP JSON-RPC)
// and optionally to a local file. Every payload passes through redact().

export type LogLevel = 'info' | 'warn' | 'error';
export type LogEntry = { ts: string; level: LogLevel; event: string; [key: string]: unknown };

export interface LoggerOptions {
    /** Append entries to this file as well (directory is created if missing). */
    file?: string | undefined;
    /** Write entries to stderr. Default: true. */
    stderr?: boolean;
    /** Extra in-process consumer, used by tests. */
    sink?: (entry: LogEntry) => void;
}

export class Logger {
    #file: string | undefined;
    readonly #stderr: boolean;
    readonly #sink: ((entry: LogEntry) => void) | undefined;

    constructor(options: LoggerOptions = {}) {
        this.#stderr = options.stderr ?? true;
        this.#sink = options.sink;
        this.#file = options.file;
        if (this.#file) {
            try {
                mkdirSync(path.dirname(this.#file), { recursive: true });
            } catch (error) {
                this.#disableFile(error);
            }
        }
    }

    log(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
        const entry: LogEntry = { ts: new Date().toISOString(), level, event, ...(redact(data) as Record<string, unknown>) };
        const line = `${JSON.stringify(entry)}\n`;
        if (this.#stderr) process.stderr.write(line);
        if (this.#file) {
            try {
                appendFileSync(this.#file, line);
            } catch (error) {
                this.#disableFile(error);
            }
        }
        this.#sink?.(entry);
    }

    #disableFile(error: unknown): void {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'log_file_disabled', reason })}\n`);
        this.#file = undefined;
    }
}
