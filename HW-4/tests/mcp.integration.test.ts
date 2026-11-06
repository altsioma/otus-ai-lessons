import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { getFileOutlineOutput, lookupDocsOutput, runCheckOutput, searchCodeOutput, toolErrorSchema } from '../src/contracts.ts';

// End-to-end: the built server (dist/main.js) is spawned over stdio and driven by the SDK client.
const SERVER_ENTRY = new URL('../dist/main.js', import.meta.url).pathname;

describe('MCP server over stdio (SDK client)', () => {
    const logDir = mkdtempSync(path.join(tmpdir(), 'dev-helper-it-'));
    const logFile = path.join(logDir, 'server.log');
    const client = new Client({ name: 'integration-test', version: '0.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_ENTRY],
        env: { ...getDefaultEnvironment(), LOG_FILE: logFile },
        stderr: 'pipe'
    });
    const logEntries = () =>
        readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

    before(() => client.connect(transport));
    after(async () => {
        await client.close();
        rmSync(logDir, { recursive: true, force: true });
    });

    test('tools/list advertises four tools with input and output schemas', async () => {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_file_outline', 'lookup_docs', 'run_check', 'search_code']);
        for (const tool of tools) {
            assert.ok(tool.description && tool.description.length > 40);
            assert.equal(tool.inputSchema.type, 'object');
            assert.equal(tool.outputSchema?.type, 'object');
        }
        const runCheck = tools.find(tool => tool.name === 'run_check')!;
        assert.deepEqual((runCheck.inputSchema.properties as Record<string, { enum?: string[] }>).check?.enum, ['test', 'typecheck']);
    });

    test('tools/call returns structured results for every tool', async () => {
        const search = await client.callTool({ name: 'search_code', arguments: { query: 'applyDiscount' } });
        assert.ok(searchCodeOutput.parse(search.structuredContent).totalMatches >= 3);

        const outline = await client.callTool({ name: 'get_file_outline', arguments: { path: 'src/cart.ts' } });
        assert.ok(getFileOutlineOutput.parse(outline.structuredContent).exports.some(item => item.name === 'Cart'));

        const docs = await client.callTool({ name: 'lookup_docs', arguments: { topic: 'округление цен' } });
        assert.equal(lookupDocsOutput.parse(docs.structuredContent).results[0]?.source, 'pricing-rounding.md');

        const check = await client.callTool({ name: 'run_check', arguments: { check: 'typecheck' } });
        assert.equal(runCheckOutput.parse(check.structuredContent).passed, true);
    });

    test('tool errors come back as isError with the documented payload', async () => {
        const result = await client.callTool({ name: 'get_file_outline', arguments: { path: '../../.env' } });
        assert.equal(result.isError, true);
        assert.equal(toolErrorSchema.parse(result.structuredContent).error.code, 'PATH_OUTSIDE_ROOT');
    });

    test('invalid arguments are rejected by the SDK before the handler runs', async () => {
        const result = await client.callTool({ name: 'run_check', arguments: { check: 'rm -rf /' } });
        assert.equal(result.isError, true);
        assert.match((result.content[0] as { text: string }).text, /Input validation error/);
    });

    test('every call is logged with tool, args, status and duration', () => {
        const calls = logEntries().filter(entry => entry.event === 'tool_call');
        const find = (tool: string, status: string) => calls.find(entry => entry.tool === tool && entry.status === status);

        for (const tool of ['search_code', 'get_file_outline', 'lookup_docs', 'run_check']) {
            const entry = find(tool, 'success');
            assert.ok(entry, `no success log for ${tool}`);
            assert.equal(typeof entry.durationMs, 'number');
            assert.ok(entry.args && typeof entry.args === 'object');
        }
        assert.deepEqual(find('get_file_outline', 'error')?.args, { path: '../../.env' });
        assert.equal(find('get_file_outline', 'error')?.errorCode, 'PATH_OUTSIDE_ROOT');

        const rejected = find('run_check', 'error');
        assert.equal(rejected?.errorCode, 'INVALID_INPUT');
        assert.equal(rejected?.stage, 'sdk_validation');
        assert.deepEqual(rejected?.args, { check: 'rm -rf /' });
    });
});
