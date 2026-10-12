import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ToolErrorPayload } from './contracts.ts';
import { ToolError } from './errors.ts';
import type { Logger } from './logger.ts';

/**
 * Wraps a tool implementation: logs one `tool_call` entry per executed call
 * (tool, redacted args, status, durationMs, errorCode) and converts the outcome
 * into an MCP CallToolResult with `structuredContent`.
 * Success → structuredContent is the tool output (validated by the SDK against outputSchema).
 * Failure → isError: true and structuredContent { error: { code, message } }.
 */
export function withLogging<Input extends object, Output extends Record<string, unknown>>(
    toolName: string,
    logger: Logger,
    impl: (input: Input) => Promise<Output>
): (input: Input) => Promise<CallToolResult> {
    return async input => {
        const callId = randomUUID();
        const started = performance.now();
        const elapsed = () => Math.round(performance.now() - started);

        try {
            const output = await impl(input);
            logger.log('info', 'tool_call', { callId, tool: toolName, args: input, status: 'success', durationMs: elapsed() });
            return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
        } catch (error) {
            const known = error instanceof ToolError;
            const failure = known ? error : new ToolError('INTERNAL_ERROR', `Internal error in ${toolName}`);
            logger.log(known ? 'warn' : 'error', 'tool_call', {
                callId,
                tool: toolName,
                args: input,
                status: 'error',
                durationMs: elapsed(),
                errorCode: failure.code,
                errorMessage: failure.message,
                // Unexpected errors: keep the original message for debugging, only in local logs.
                ...(known ? {} : { cause: error instanceof Error ? error.message : String(error) })
            });
            const payload: ToolErrorPayload = { error: { code: failure.code, message: failure.message } };
            return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
        }
    };
}
