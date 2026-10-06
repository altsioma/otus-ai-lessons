// Всё, что относится к локальному серверу Ollama: таймаут запросов модели, preflight-проверка
// сервера и модели, понятные сообщения об ошибках. Импорт модуля не выполняет сетевых запросов.

export const OLLAMA_ERROR_CODES = Object.freeze({
  unavailable: 'OLLAMA_UNAVAILABLE',
  modelNotFound: 'OLLAMA_MODEL_NOT_FOUND',
  timeout: 'OLLAMA_TIMEOUT',
  toolsUnsupported: 'OLLAMA_TOOLS_UNSUPPORTED',
});

export class OllamaError extends Error {
  /** @param {string} code одно из OLLAMA_ERROR_CODES */
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = 'OllamaError';
    this.code = code;
  }
}

export const pullCommand = (model) => `ollama pull ${model}`;

const NETWORK_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN', 'UND_ERR_SOCKET']);

/** Ошибка и все её причины (error.cause), от внешней к внутренней. */
function errorChain(error) {
  const chain = [];
  for (let current = error; current && chain.length < 10; current = current.cause) {
    chain.push(current);
  }
  return chain;
}

const isTimeout = (error) => errorChain(error).some((e) => e?.name === 'TimeoutError' || e?.code === 'UND_ERR_HEADERS_TIMEOUT');
const isConnectionError = (error) =>
  errorChain(error).some((e) => NETWORK_ERROR_CODES.has(e?.code)) ||
  (error?.name === 'TypeError' && /fetch failed/i.test(error?.message ?? ''));

/**
 * Обёртка над fetch для ChatOllama: каждый запрос к модели ограничен timeoutMs
 * (включая чтение потокового ответа). Глобальный fetch берётся в момент запроса.
 */
export function createTimeoutFetch(timeoutMs, fetchImpl = (...args) => globalThis.fetch(...args)) {
  return (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetchImpl(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}

/**
 * Превращает ошибку обращения к Ollama в OllamaError с понятным сообщением.
 * Возвращает null, если ошибка не относится к Ollama.
 *
 * @param {unknown} error
 * @param {{ baseUrl?: string, model?: string }} [context]
 * @returns {OllamaError | null}
 */
export function toOllamaError(error, { baseUrl, model } = {}) {
  if (error instanceof OllamaError) {
    return error;
  }
  const where = baseUrl ? ` по адресу ${baseUrl}` : '';
  const message = String(error?.error ?? error?.message ?? '');

  if (isTimeout(error)) {
    return new OllamaError(
      OLLAMA_ERROR_CODES.timeout,
      `Превышено время ожидания ответа Ollama${where}. Модель может ещё загружаться в память — повторите запрос или увеличьте OLLAMA_TIMEOUT_MS.`,
      { cause: error },
    );
  }
  if (isConnectionError(error)) {
    return new OllamaError(
      OLLAMA_ERROR_CODES.unavailable,
      `Ollama не запущен или недоступен${where}. Запустите сервер командой: ollama serve (адрес задаётся OLLAMA_BASE_URL).`,
      { cause: error },
    );
  }
  if (/does not support tools/i.test(message)) {
    return new OllamaError(
      OLLAMA_ERROR_CODES.toolsUnsupported,
      `${model ? `Модель ${model}` : 'Модель'} не поддерживает tool calling в Ollama. Выберите модель с поддержкой tools в OLLAMA_MODEL (например, qwen3:8b).`,
      { cause: error },
    );
  }
  if (error?.status_code === 404 || /model .* not found/i.test(message)) {
    // Имя модели берём из конфигурации, а при её отсутствии — из текста ошибки Ollama.
    const name = model ?? /model ["']?([^"'\s]+)["']? not found/i.exec(message)?.[1];
    return new OllamaError(
      OLLAMA_ERROR_CODES.modelNotFound,
      name
        ? `Модель ${name} не найдена в Ollama. Установите её командой: ${pullCommand(name)}`
        : 'Модель не найдена в Ollama. Проверьте OLLAMA_MODEL и установите модель командой ollama pull <имя модели>.',
      { cause: error },
    );
  }
  return null;
}

const modelMatches = (installed, wanted) =>
  installed === wanted || installed === `${wanted}:latest` || `${installed}:latest` === wanted;

async function getJson(fetchImpl, url, timeoutMs, context) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw toOllamaError(error, context) ?? error;
  }
  if (!response.ok) {
    throw new OllamaError(
      OLLAMA_ERROR_CODES.unavailable,
      `Ollama по адресу ${context.baseUrl} ответил HTTP ${response.status} на ${new URL(url).pathname}. Проверьте, что OLLAMA_BASE_URL указывает на сервер Ollama (ollama serve).`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new OllamaError(
      OLLAMA_ERROR_CODES.unavailable,
      `По адресу ${context.baseUrl} отвечает не Ollama: ответ ${new URL(url).pathname} не является JSON.`,
      { cause: error },
    );
  }
}

/**
 * Preflight перед live evaluation: сервер Ollama доступен, модель установлена и умеет tools.
 * Модель никогда не скачивается автоматически — при её отсутствии в ошибке указана команда ollama pull.
 *
 * @param {object} options
 * @param {string} options.baseUrl OLLAMA_BASE_URL
 * @param {string} options.model OLLAMA_MODEL
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs] таймаут каждого служебного запроса
 * @returns {Promise<{ baseUrl: string, model: string, version: string | null, capabilities: string[] | null }>}
 * @throws {OllamaError}
 */
export async function checkOllama({ baseUrl, model, fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 5000 }) {
  const context = { baseUrl, model };
  const { version = null } = await getJson(fetchImpl, `${baseUrl}/api/version`, timeoutMs, context);
  const { models = [] } = await getJson(fetchImpl, `${baseUrl}/api/tags`, timeoutMs, context);

  const installed = models.find((entry) => modelMatches(entry.name ?? entry.model, model));
  if (!installed) {
    const names = models.map((entry) => entry.name ?? entry.model);
    throw new OllamaError(
      OLLAMA_ERROR_CODES.modelNotFound,
      `Модель ${model} не установлена в Ollama (${baseUrl}). Установите её командой: ${pullCommand(model)}` +
        (names.length > 0 ? `. Установленные модели: ${names.join(', ')} — любую из них можно выбрать через OLLAMA_MODEL.` : ''),
    );
  }

  // Старые версии Ollama не сообщают capabilities — тогда поддержку tools проверить заранее нельзя.
  const capabilities = Array.isArray(installed.capabilities) ? installed.capabilities : null;
  if (capabilities && !capabilities.includes('tools')) {
    throw new OllamaError(
      OLLAMA_ERROR_CODES.toolsUnsupported,
      `Модель ${model} не поддерживает tool calling (capabilities: ${capabilities.join(', ')}). Выберите модель с поддержкой tools, например qwen3:8b.`,
    );
  }
  return { baseUrl, model, version, capabilities };
}
