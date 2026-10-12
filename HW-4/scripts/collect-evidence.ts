// Extracts proof of real dev-helper tool calls from a Claude Code trace, without copying unrelated data.
//
// Usage: node scripts/collect-evidence.ts <trace.jsonl> <name>
//   <trace.jsonl> — Claude Code session transcript (~/.claude/projects/<project>/<session-id>.jsonl, written by the
//                   CLI and the IDE extension) or `claude -p --output-format stream-json --verbose` output.
//   <name>        — output name, e.g. "ide-session".
//
// Writes:
//   evidence/traces/<name>.jsonl     — session info, user prompts, mcp__dev-helper__* tool_use / tool_result, answers
//   evidence/server-log/<name>.jsonl — tool_call entries from logs/mcp-server.log within the trace's time window
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOOL_PREFIX = 'mcp__dev-helper__';
const MAX_TEXT = 600;

const [tracePath, name] = process.argv.slice(2);
if (!tracePath || !name || !/^[\w.-]+$/.test(name)) {
    console.error('Usage: node scripts/collect-evidence.ts <trace.jsonl> <name>');
    process.exit(1);
}

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean; content?: unknown };
type Line = {
    type?: string;
    subtype?: string;
    timestamp?: string;
    sessionId?: string;
    session_id?: string;
    entrypoint?: string;
    version?: string;
    claude_code_version?: string;
    cwd?: string;
    model?: string;
    isMeta?: boolean;
    message?: { content?: string | Block[] };
    mcp_servers?: unknown;
    result?: string;
};

const clip = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text);
const lines: Line[] = readFileSync(tracePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Line);

const out: Record<string, unknown>[] = [];
const devHelperCalls = new Set<string>();
let session: Record<string, unknown> | undefined;
const times: number[] = [];

for (const line of lines) {
    if (line.timestamp) times.push(Date.parse(line.timestamp));

    if (line.sessionId || (line.type === 'system' && line.subtype === 'init')) {
        if (!session) {
            session = { kind: 'session', source: line.type === 'system' ? 'stream-json' : 'transcript' };
            out.push(session);
        }
        // Fields appear on different lines of a transcript: keep the first value seen for each.
        const fields: Record<string, unknown> = {
            sessionId: line.sessionId ?? line.session_id,
            entrypoint: line.entrypoint,
            claudeCodeVersion: line.version ?? line.claude_code_version,
            cwd: line.cwd,
            model: line.model,
            mcpServers: line.mcp_servers
        };
        for (const [key, value] of Object.entries(fields)) if (value !== undefined && session[key] === undefined) session[key] = value;
    }
    // Claude Code's IDE bridge is an internal MCP server named "ide": record whether it connected.
    const ideFailure = JSON.stringify(line).match(/"failedMcpServers":\[[^\]]*\{"name":"ide","error":"([^"]*)"/);
    if (session && ideFailure) session.ideBridge ??= `failed: ${ideFailure[1]}`;
    if (session && JSON.stringify(line).includes('"mcp__ide__')) session.ideBridge ??= 'connected';

    const content = line.message?.content;
    const ts = line.timestamp;
    if (line.type === 'user' && !line.isMeta) {
        const texts = typeof content === 'string' ? [content] : (content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '');
        for (const text of texts) {
            if (text.trim() && !text.trimStart().startsWith('<')) out.push({ kind: 'user_prompt', ts, text: clip(text.trim()) });
        }
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
        if (block.type === 'tool_use' && block.name?.startsWith(TOOL_PREFIX)) {
            devHelperCalls.add(block.id ?? '');
            out.push({ kind: 'tool_use', ts, id: block.id, tool: block.name, input: block.input });
        } else if (block.type === 'tool_result' && devHelperCalls.has(block.tool_use_id ?? '')) {
            const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            out.push({ kind: 'tool_result', ts, toolUseId: block.tool_use_id, isError: block.is_error ?? false, content: clip(raw) });
        } else if (line.type === 'assistant' && block.type === 'text' && block.text?.trim()) {
            out.push({ kind: 'assistant_text', ts, text: clip(block.text.trim()) });
        }
    }
    if (line.type === 'result' && line.result) out.push({ kind: 'final_result', text: clip(line.result) });
}

if (devHelperCalls.size === 0) console.warn(`warning: no ${TOOL_PREFIX}* tool calls found in ${tracePath}`);

// Server log entries within the trace window (stream-json lines have no timestamps: then take all tool calls).
let serverLog: string[] = [];
try {
    const from = times.length > 0 ? Math.min(...times) - 5_000 : -Infinity;
    const to = times.length > 0 ? Math.max(...times) + 5_000 : Infinity;
    serverLog = readFileSync(path.join(ROOT, 'logs/mcp-server.log'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .filter(entry => {
            const parsed = JSON.parse(entry) as { event?: string; ts?: string };
            const at = Date.parse(parsed.ts ?? '');
            return parsed.event === 'tool_call' && at >= from && at <= to;
        });
} catch {
    console.warn('warning: logs/mcp-server.log not found; server log not collected');
}

for (const dir of ['traces', 'server-log']) mkdirSync(path.join(ROOT, 'evidence', dir), { recursive: true });
const tracesOut = path.join(ROOT, 'evidence/traces', `${name}.jsonl`);
const logOut = path.join(ROOT, 'evidence/server-log', `${name}.jsonl`);
writeFileSync(tracesOut, out.map(record => JSON.stringify(record)).join('\n') + '\n');
writeFileSync(logOut, serverLog.length > 0 ? `${serverLog.join('\n')}\n` : '');

console.log(`session: ${JSON.stringify(session ?? null)}`);
console.log(`dev-helper tool calls in trace: ${devHelperCalls.size}; tool_call log entries: ${serverLog.length}`);
for (const record of out.filter(r => r.kind === 'tool_use')) console.log(`  ${String(record.ts ?? '')} ${String(record.tool)} ${JSON.stringify(record.input)}`);
console.log(`wrote ${path.relative(ROOT, tracesOut)} and ${path.relative(ROOT, logOut)}`);
