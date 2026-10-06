import { runCli } from './src/cli.js';

// CLI агента: npm start -- "<запрос>". AGENT_DEBUG=1 включает вывод stack trace в stderr.
process.exitCode = await runCli(process.argv.slice(2), { debug: process.env.AGENT_DEBUG === '1' });
