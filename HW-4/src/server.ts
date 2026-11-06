import { McpServer } from '@modelcontextprotocol/server';
import { TOOLS } from './contracts.ts';
import type { Logger } from './logger.ts';
import type { ToolContext } from './tools/context.ts';
import { getFileOutline } from './tools/getFileOutline.ts';
import { lookupDocs } from './tools/lookupDocs.ts';
import { runCheck } from './tools/runCheck.ts';
import { searchCode } from './tools/searchCode.ts';
import { withLogging } from './withLogging.ts';

export const SERVER_NAME = 'dev-helper';
export const SERVER_VERSION = '0.1.0';

export interface ServerDeps {
    ctx: ToolContext;
    logger: Logger;
}

/** Creates one MCP server instance with all four tools registered. */
export function createServer({ ctx, logger }: ServerDeps): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
    const { searchCode: search, getFileOutline: outline, lookupDocs: docs, runCheck: check } = TOOLS;

    server.registerTool(
        search.name,
        { title: search.title, description: search.description, inputSchema: search.inputSchema, outputSchema: search.outputSchema, annotations: search.annotations },
        withLogging(search.name, logger, input => searchCode(input, ctx))
    );
    server.registerTool(
        outline.name,
        { title: outline.title, description: outline.description, inputSchema: outline.inputSchema, outputSchema: outline.outputSchema, annotations: outline.annotations },
        withLogging(outline.name, logger, input => getFileOutline(input, ctx))
    );
    server.registerTool(
        docs.name,
        { title: docs.title, description: docs.description, inputSchema: docs.inputSchema, outputSchema: docs.outputSchema, annotations: docs.annotations },
        withLogging(docs.name, logger, input => lookupDocs(input, ctx))
    );
    server.registerTool(
        check.name,
        { title: check.title, description: check.description, inputSchema: check.inputSchema, outputSchema: check.outputSchema, annotations: check.annotations },
        withLogging(check.name, logger, input => runCheck(input, ctx))
    );

    return server;
}
