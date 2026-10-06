import { ChatOllama } from '@langchain/ollama';
import { DEFAULT_OLLAMA_TIMEOUT_MS } from '../config.js';
import { createTaskTools } from '../tools/task-tools.js';
import { createTimeoutFetch } from './ollama.js';
import { createTaskAgent } from './task-agent.js';

/**
 * Собирает production-агента: ChatOllama (локальный Ollama) + HTTP tools локального API.
 * Конструктор ChatOllama сетевых запросов не делает; токены и ключи не нужны.
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {object} [options]
 * @param {Pick<Console, 'info'>} [options.logger] куда tools пишут отладочный вывод
 * @param {typeof fetch} [options.fetchImpl] fetch для запросов к Ollama (для тестов)
 */
export function createConfiguredTaskAgent(config, { logger = console, fetchImpl } = {}) {
  const model = new ChatOllama({
    model: config.ollama.model,
    baseUrl: config.ollama.baseUrl,
    temperature: 0,
    // qwen3 — «думающая» модель; рассуждения не нужны для выбора tool и сильно замедляют ответ.
    think: false,
    // System prompt и JSON Schema пяти tools занимают ~10 тыс. символов; при типичном для Ollama
    // контексте 4096 токенов начало диалога (system prompt) молча обрезалось бы.
    numCtx: 8192,
    fetch: createTimeoutFetch(config.ollama.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS, fetchImpl),
  });
  const tools = createTaskTools({ baseUrl: config.api.baseUrl, logger });

  return { agent: createTaskAgent({ model, tools }), model, tools };
}
