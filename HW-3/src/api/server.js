import { loadConfig } from '../config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp();

const server = app.listen(config.api.port, (error) => {
  if (error) {
    console.error(`Не удалось запустить API на порту ${config.api.port}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Tasks API запущен: http://localhost:${config.api.port} (данные хранятся в памяти)`);
});

function shutdown(signal) {
  console.log(`Получен ${signal}, останавливаю сервер...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
