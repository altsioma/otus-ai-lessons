import dotenv from 'dotenv';
import { z } from 'zod';

// Загружаем .env один раз при импорте. Отсутствие файла не является ошибкой.
dotenv.config({ quiet: true });

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
export const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;

// Пустые строки из .env (например, `OLLAMA_MODEL=`) считаем незаданными значениями.
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const envSchema = z.object({
  OLLAMA_BASE_URL: optionalString.pipe(z.url().default(DEFAULT_OLLAMA_BASE_URL)),
  OLLAMA_MODEL: optionalString.transform((value) => value ?? DEFAULT_OLLAMA_MODEL),
  OLLAMA_TIMEOUT_MS: optionalString.pipe(z.coerce.number().int().min(1000).default(DEFAULT_OLLAMA_TIMEOUT_MS)),
  API_PORT: optionalString.pipe(z.coerce.number().int().min(1).max(65535).default(3000)),
  API_BASE_URL: optionalString.pipe(z.url().optional()),
});

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const trimSlashes = (url) => url.replace(/\/+$/, '');

/**
 * Читает и валидирует конфигурацию из переменных окружения.
 * Никаких токенов и ключей не требуется: модель работает в локальном Ollama.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 */
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(`Некорректная конфигурация:\n${z.prettifyError(result.error)}`);
  }

  const { OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_MS, API_PORT, API_BASE_URL } = result.data;

  return Object.freeze({
    ollama: Object.freeze({
      baseUrl: trimSlashes(OLLAMA_BASE_URL),
      model: OLLAMA_MODEL,
      timeoutMs: OLLAMA_TIMEOUT_MS,
    }),
    api: Object.freeze({
      port: API_PORT,
      baseUrl: trimSlashes(API_BASE_URL ?? `http://localhost:${API_PORT}`),
    }),
  });
}
