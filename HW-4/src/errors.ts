import type { ErrorCode } from './contracts.ts';

/** Expected, documented tool failure. Its message is returned to the client, so it must not contain secrets. */
export class ToolError extends Error {
    readonly code: ErrorCode;

    constructor(code: ErrorCode, message: string) {
        super(message);
        this.name = 'ToolError';
        this.code = code;
    }
}
