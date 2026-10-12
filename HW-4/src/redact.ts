// Makes values safe to log: hides sensitive keys and secret-looking strings, bounds size.

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /pass(word|phrase)?|secret|token|api[-_]?key|auth|credential|private[-_]?key|cookie|session/i;
const SECRET_VALUE: RegExp[] = [
    /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI/Anthropic-style API keys
    /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
    /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];

const MAX_STRING = 200;
const MAX_ARRAY = 20;
const MAX_DEPTH = 5;

export function redact(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') {
        if (SECRET_VALUE.some(pattern => pattern.test(value))) return REDACTED;
        return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING} chars)` : value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (depth >= MAX_DEPTH) return '[TRUNCATED]';
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY).map(item => redact(item, depth + 1));
        if (value.length > MAX_ARRAY) items.push(`…(+${value.length - MAX_ARRAY} items)`);
        return items;
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1)])
    );
}
