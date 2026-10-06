import { describe, expect, it, vi } from 'vitest';
import { checkOllama, createTimeoutFetch, OLLAMA_ERROR_CODES, OllamaError, toOllamaError } from '../src/agent/ollama.js';

const BASE_URL = 'http://127.0.0.1:11434';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tagsEntry = (name, capabilities = ['completion', 'tools', 'thinking']) => ({ name, model: name, capabilities });

/** Мок fetch сервера Ollama: /api/version и /api/tags; любые другие пути — ошибка теста. */
function mockOllama({ models = [tagsEntry('qwen3:8b')], version = '0.34.3' } = {}) {
  return vi.fn(async (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/api/version') return json({ version });
    if (pathname === '/api/tags') return json({ models });
    throw new Error(`неожиданный запрос ${pathname}`);
  });
}

const connectionRefused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }) });

async function expectOllamaError(promise, code) {
  const error = await promise.then(
    () => {
      throw new Error('ожидалась OllamaError');
    },
    (e) => e,
  );
  expect(error).toBeInstanceOf(OllamaError);
  expect(error.code).toBe(code);
  return error;
}

describe('checkOllama (preflight)', () => {
  it('проходит, если сервер доступен и модель установлена', async () => {
    const fetchImpl = mockOllama();

    const result = await checkOllama({ baseUrl: BASE_URL, model: 'qwen3:8b', fetchImpl });

    expect(result).toEqual({ baseUrl: BASE_URL, model: 'qwen3:8b', version: '0.34.3', capabilities: ['completion', 'tools', 'thinking'] });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([`${BASE_URL}/api/version`, `${BASE_URL}/api/tags`]);
  });

  it('находит модель с тегом :latest по имени без тега', async () => {
    const fetchImpl = mockOllama({ models: [tagsEntry('mymodel:latest')] });

    await expect(checkOllama({ baseUrl: BASE_URL, model: 'mymodel', fetchImpl })).resolves.toMatchObject({ model: 'mymodel' });
  });

  it('позволяет выбрать установленную qwen3:4b через OLLAMA_MODEL', async () => {
    const fetchImpl = mockOllama({ models: [tagsEntry('qwen3:4b')] });

    await expect(checkOllama({ baseUrl: BASE_URL, model: 'qwen3:4b', fetchImpl })).resolves.toMatchObject({ model: 'qwen3:4b' });
  });

  it('сообщает, что Ollama не запущен, если соединение отклонено', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(connectionRefused());

    const error = await expectOllamaError(checkOllama({ baseUrl: BASE_URL, model: 'qwen3:8b', fetchImpl }), OLLAMA_ERROR_CODES.unavailable);

    expect(error.message).toBe(
      `Ollama не запущен или недоступен по адресу ${BASE_URL}. Запустите сервер командой: ollama serve (адрес задаётся OLLAMA_BASE_URL).`,
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('сообщает о превышении времени ожидания', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

    const error = await expectOllamaError(checkOllama({ baseUrl: BASE_URL, model: 'qwen3:8b', fetchImpl }), OLLAMA_ERROR_CODES.timeout);

    expect(error.message).toMatch(/^Превышено время ожидания ответа Ollama/);
  });

  it('сообщает, если по адресу отвечает не Ollama', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));

    const error = await expectOllamaError(checkOllama({ baseUrl: BASE_URL, model: 'qwen3:8b', fetchImpl }), OLLAMA_ERROR_CODES.unavailable);

    expect(error.message).toContain('ответил HTTP 404 на /api/version');
  });

  it('при отсутствии модели выводит точную команду ollama pull и не скачивает модель', async () => {
    const fetchImpl = mockOllama({ models: [tagsEntry('qwen3:4b')] });

    const error = await expectOllamaError(checkOllama({ baseUrl: BASE_URL, model: 'qwen3:8b', fetchImpl }), OLLAMA_ERROR_CODES.modelNotFound);

    expect(error.message).toContain('Модель qwen3:8b не установлена в Ollama');
    expect(error.message).toContain('Установите её командой: ollama pull qwen3:8b');
    expect(error.message).toContain('Установленные модели: qwen3:4b');
    // Только чтение: ни /api/pull, ни других запросов.
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/version', '/api/tags']);
  });

  it('отклоняет модель без поддержки tools', async () => {
    const fetchImpl = mockOllama({ models: [tagsEntry('gemma:2b', ['completion'])] });

    const error = await expectOllamaError(checkOllama({ baseUrl: BASE_URL, model: 'gemma:2b', fetchImpl }), OLLAMA_ERROR_CODES.toolsUnsupported);

    expect(error.message).toContain('не поддерживает tool calling');
  });

  it('пропускает проверку tools, если Ollama не сообщает capabilities', async () => {
    const fetchImpl = mockOllama({ models: [{ name: 'qwen3:8b' }] });

    await expect(checkOllama({ baseUrl: BASE_URL, model: 'qwen3:8b', fetchImpl })).resolves.toMatchObject({ capabilities: null });
  });
});

describe('toOllamaError', () => {
  // Форма ResponseError из пакета ollama (status_code + error).
  const responseError = (message, statusCode) => Object.assign(new Error(message), { name: 'ResponseError', error: message, status_code: statusCode });

  it.each([
    ['соединение отклонено', connectionRefused(), OLLAMA_ERROR_CODES.unavailable, /^Ollama не запущен или недоступен\. Запустите сервер командой: ollama serve/],
    ['таймаут', new DOMException('aborted', 'TimeoutError'), OLLAMA_ERROR_CODES.timeout, /^Превышено время ожидания ответа Ollama/],
    [
      'модель не найдена',
      responseError('model "qwen3:8b" not found, try pulling it first', 404),
      OLLAMA_ERROR_CODES.modelNotFound,
      /^Модель qwen3:8b не найдена в Ollama\. Установите её командой: ollama pull qwen3:8b$/,
    ],
    [
      'модель без tools',
      responseError('registry.ollama.ai/library/gemma:2b does not support tools', 400),
      OLLAMA_ERROR_CODES.toolsUnsupported,
      /не поддерживает tool calling/,
    ],
  ])('распознаёт ошибку: %s', (_, error, code, message) => {
    const result = toOllamaError(error);

    expect(result).toBeInstanceOf(OllamaError);
    expect(result.code).toBe(code);
    expect(result.message).toMatch(message);
    expect(result.cause).toBe(error);
  });

  it('подставляет адрес и модель из конфигурации', () => {
    expect(toOllamaError(connectionRefused(), { baseUrl: BASE_URL }).message).toContain(`по адресу ${BASE_URL}`);
    expect(toOllamaError(responseError('model not found', 404), { model: 'qwen3:4b' }).message).toContain('ollama pull qwen3:4b');
  });

  it('возвращает null для ошибок, не связанных с Ollama', () => {
    expect(toOllamaError(new TypeError('x is not a function'))).toBeNull();
  });
});

describe('createTimeoutFetch', () => {
  it('добавляет AbortSignal с таймаутом и сохраняет остальные параметры', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));

    await createTimeoutFetch(1000, fetchImpl)('http://ollama.test/api/chat', { method: 'POST', body: '{}' });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it('учитывает собственный signal запроса', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    const controller = new AbortController();

    await createTimeoutFetch(60_000, fetchImpl)('http://ollama.test/api/chat', { signal: controller.signal });
    controller.abort();

    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
