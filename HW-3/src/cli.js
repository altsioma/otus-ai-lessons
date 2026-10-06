import { ConfigError, loadConfig } from './config.js';
import { createConfiguredTaskAgent } from './agent/configured-agent.js';
import { agentErrorResult } from './agent/response-schema.js';
import { runTaskAgent } from './agent/task-agent.js';

export const EXIT_CODES = Object.freeze({ success: 0, resultError: 1, usage: 2, setupError: 3 });

export const USAGE = `Использование:
  npm start -- "<запрос на естественном языке>"

Примеры:
  npm start -- "создай задачу Подготовить отчёт"
  npm start -- "покажи статистику задач"

Перед запуском:
  ollama serve            # локальный сервер Ollama (если ещё не запущен)
  ollama pull qwen3:8b    # модель по умолчанию (OLLAMA_MODEL), один раз
  npm run api             # API задач в отдельном терминале`;

/**
 * Точка входа CLI с внедряемыми зависимостями (для тестов).
 * stdout получает только финальный JSON; логи tools и диагностика идут в stderr.
 *
 * @returns {Promise<number>} код завершения процесса
 */
export async function runCli(
  args,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    loadConfigImpl = loadConfig,
    createAgentImpl = createConfiguredTaskAgent,
    debug = false,
  } = {},
) {
  const writeResult = (result) => stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const logger = {
    info: (message) => stderr.write(`${message}\n`),
    warn: (message) => stderr.write(`${message}\n`),
    error: (message) => stderr.write(`${message}\n`),
    debug: (value) => debug && stderr.write(`${value?.stack ?? value}\n`),
  };

  const userInput = args.join(' ').trim();
  if (!userInput) {
    stderr.write(`${USAGE}\n`);
    return EXIT_CODES.usage;
  }

  let agent;
  try {
    const config = loadConfigImpl();
    ({ agent } = createAgentImpl(config, { logger }));
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      logger.error(`[cli] Ошибка инициализации агента: ${error?.name ?? 'Error'}: ${error?.message}`);
      logger.debug(error);
    }
    const message = error instanceof ConfigError ? error.message : 'Не удалось инициализировать агента.';
    writeResult(agentErrorResult([message]));
    return EXIT_CODES.setupError;
  }

  const result = await runTaskAgent({ agent, userInput, logger });
  writeResult(result);
  return result.status === 'success' ? EXIT_CODES.success : EXIT_CODES.resultError;
}
