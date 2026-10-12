import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';

const SERVER_ENTRY = new URL('../dist/main.js', import.meta.url).pathname;

type JsonRpcMessage = { jsonrpc: string; id?: number; result?: Record<string, unknown>; error?: unknown };

// Starts the built server and collects every stdout line; each must be a JSON-RPC message.
function startServer() {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER_ENTRY], { stdio: 'pipe' });
    const messages: JsonRpcMessage[] = [];
    const nonProtocolLines: string[] = [];
    let stderr = '';
    const waiters = new Map<number, (message: JsonRpcMessage) => void>();

    child.stderr.on('data', chunk => (stderr += chunk));
    createInterface({ input: child.stdout }).on('line', line => {
        try {
            const message = JSON.parse(line) as JsonRpcMessage;
            if (message.jsonrpc !== '2.0') throw new Error('not JSON-RPC 2.0');
            messages.push(message);
            if (message.id !== undefined) waiters.get(message.id)?.(message);
        } catch {
            nonProtocolLines.push(line);
        }
    });

    const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
        new Promise<JsonRpcMessage>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}; stderr: ${stderr}`)), 5000);
            waiters.set(id, message => {
                clearTimeout(timer);
                resolve(message);
            });
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
    const notify = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);

    return { child, messages, nonProtocolLines, request, notify, stderr: () => stderr };
}

async function initialize(server: ReturnType<typeof startServer>) {
    const response = await server.request(1, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '0.0.0' }
    });
    server.notify('notifications/initialized');
    return response;
}

test('handshake over stdio: stdout carries only JSON-RPC, diagnostics go to stderr', async () => {
    const server = startServer();
    const init = await initialize(server);
    assert.equal(init.error, undefined);
    assert.deepEqual(init.result?.serverInfo, { name: 'dev-helper', version: '0.1.0' });

    const tools = await server.request(2, 'tools/list');
    const names = (tools.result?.tools as Array<{ name: string }>).map(tool => tool.name).sort();
    assert.deepEqual(names, ['get_file_outline', 'lookup_docs', 'run_check', 'search_code']);

    const call = await server.request(3, 'tools/call', { name: 'search_code', arguments: { query: 'applyDiscount' } });
    assert.equal(call.result?.isError, undefined);
    assert.ok((call.result?.structuredContent as { totalMatches: number }).totalMatches > 0);

    server.child.stdin.end();
    const [code] = await once(server.child, 'exit');
    assert.equal(code, 0, 'server exits cleanly when stdin closes');
    assert.deepEqual(server.nonProtocolLines, [], 'no diagnostics on stdout');
    assert.match(server.stderr(), /"event":"server_started"/);
    assert.match(server.stderr(), /"event":"tool_call".*"tool":"search_code".*"status":"success"/);
    assert.match(server.stderr(), /"reason":"stdin_closed"/);
});

test('graceful shutdown on SIGTERM', async () => {
    const server = startServer();
    await initialize(server);
    server.child.kill('SIGTERM');
    const [code] = await once(server.child, 'exit');
    assert.equal(code, 0);
    assert.match(server.stderr(), /"reason":"SIGTERM"/);
    assert.deepEqual(server.nonProtocolLines, []);
});
