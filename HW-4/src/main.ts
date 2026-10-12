import { existsSync } from 'node:fs';
import path from 'node:path';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadConfig, PACKAGE_ROOT } from './config.ts';
import { Logger } from './logger.ts';
import { AuditedTransport } from './protocolAudit.ts';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.ts';

// Optional local overrides; variables already set by the MCP client take precedence.
const envFile = path.join(PACKAGE_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

let config;
try {
    config = loadConfig();
} catch (error) {
    new Logger().log('error', 'config_invalid', { message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}

const logger = new Logger({ file: config.logFile });
const ctx = { projectRoot: config.projectRoot, docsRoot: config.docsRoot, checkTimeoutMs: config.checkTimeoutMs };

const handle = serveStdio(() => createServer({ ctx, logger }), {
    transport: new AuditedTransport(new StdioServerTransport(), logger),
    onerror: error => logger.log('error', 'transport_error', { message: error.message })
});

logger.log('info', 'server_started', {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: 'stdio',
    pid: process.pid,
    projectRoot: config.projectRoot,
    docsRoot: config.docsRoot,
    logFile: config.logFile ?? null,
    checkTimeoutMs: config.checkTimeoutMs
});

let shuttingDown = false;

async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log('info', 'server_stopping', { reason });
    try {
        await handle.close();
        process.exitCode = 0;
    } catch (error) {
        logger.log('error', 'shutdown_failed', { message: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
    } finally {
        process.exit();
    }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
// The client closing stdin means the connection is over (MCP stdio binding).
process.stdin.on('end', () => void shutdown('stdin_closed'));
