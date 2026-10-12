import type { JSONRPCMessage, MessageExtraInfo, Transport, TransportSendOptions } from '@modelcontextprotocol/server';
import type { Logger } from './logger.ts';

/**
 * Transport decorator that logs tools/call requests the SDK answers *without* running the
 * handler: input-schema rejections, output-schema rejections and unknown tools.
 * Calls that reach a handler are logged by withLogging; their error results always carry
 * structuredContent, so they are not logged twice here.
 */
export class AuditedTransport implements Transport {
    readonly #inner: Transport;
    readonly #logger: Logger;
    readonly #pending = new Map<string | number, { tool: string; args: unknown; started: number }>();

    onclose?: (() => void) | undefined;
    onerror?: ((error: Error) => void) | undefined;
    onmessage?: (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void) | undefined;

    constructor(inner: Transport, logger: Logger) {
        this.#inner = inner;
        this.#logger = logger;
        inner.onclose = () => this.onclose?.();
        inner.onerror = error => this.onerror?.(error);
        inner.onmessage = (message, extra) => {
            this.#observeIncoming(message);
            this.onmessage?.(message, extra);
        };
    }

    get sessionId(): string | undefined {
        return this.#inner.sessionId;
    }

    setProtocolVersion(version: string): void {
        this.#inner.setProtocolVersion?.(version);
    }

    start(): Promise<void> {
        return this.#inner.start();
    }

    close(): Promise<void> {
        return this.#inner.close();
    }

    send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
        this.#observeOutgoing(message);
        return this.#inner.send(message, options);
    }

    #observeIncoming(message: JSONRPCMessage): void {
        if (!('method' in message) || message.method !== 'tools/call' || !('id' in message)) return;
        const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
        this.#pending.set(message.id, { tool: String(params.name), args: params.arguments ?? {}, started: performance.now() });
    }

    #observeOutgoing(message: JSONRPCMessage): void {
        if (!('id' in message) || 'method' in message || message.id === undefined) return;
        const call = this.#pending.get(message.id);
        if (!call) return;
        this.#pending.delete(message.id);

        const base = { tool: call.tool, args: call.args, status: 'error', durationMs: Math.round(performance.now() - call.started) };
        if ('error' in message) {
            this.#logger.log('warn', 'tool_call', { ...base, stage: 'protocol', errorCode: 'PROTOCOL_ERROR', errorMessage: message.error.message });
            return;
        }
        const result = message.result as { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> };
        if (result.isError === true && result.structuredContent === undefined) {
            const text = result.content?.[0]?.text ?? '';
            const errorCode = text.startsWith('Input validation error') ? 'INVALID_INPUT' : 'SDK_ERROR';
            this.#logger.log('warn', 'tool_call', { ...base, stage: 'sdk_validation', errorCode, errorMessage: text });
        }
    }
}
