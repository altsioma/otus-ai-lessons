import { ChatOllama } from '@langchain/ollama';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createTaskStore } from '../src/api/task-store.js';
import { createConfiguredTaskAgent } from '../src/agent/configured-agent.js';
import { RESPONSE_TOOL_NAME } from '../src/agent/response-schema.js';
import { runTaskAgent } from '../src/agent/task-agent.js';
import { loadConfig } from '../src/config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const silentLogger = () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

describe('импорт agent-модулей', () => {
  it('не требует токенов и не обращается к сети', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.resetModules();

    const modules = await Promise.all([
      import('../src/agent/task-agent.js'),
      import('../src/agent/configured-agent.js'),
      import('../src/agent/ollama.js'),
      import('../src/agent/response-schema.js'),
      import('../src/prompts/system-prompt.js'),
      import('../src/prompts/user-prompt.js'),
      import('../src/cli.js'),
    ]);

    expect(modules.every(Boolean)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createConfiguredTaskAgent', () => {
  it('создаёт ChatOllama из конфигурации и HTTP tools без сетевых запросов', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const config = loadConfig({ OLLAMA_BASE_URL: 'http://ollama.test:11434', OLLAMA_MODEL: 'qwen3:4b', API_BASE_URL: 'http://api.test:1234' });

    const { agent, model, tools } = createConfiguredTaskAgent(config, { logger: { info: vi.fn() } });

    expect(model).toBeInstanceOf(ChatOllama);
    expect(model.model).toBe('qwen3:4b');
    expect(model.baseUrl).toBe('http://ollama.test:11434');
    expect(model.temperature).toBe(0);
    expect(model.checkOrPullModel).toBe(false);
    expect(tools.map((t) => t.name)).toEqual(['create_task', 'get_task', 'update_task_status', 'get_task_stats']);
    expect(typeof agent.invoke).toBe('function');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('по умолчанию использует qwen3:8b на http://127.0.0.1:11434', () => {
    const { model } = createConfiguredTaskAgent(loadConfig({}), { logger: { info: vi.fn() } });

    expect(model.model).toBe('qwen3:8b');
    expect(model.baseUrl).toBe('http://127.0.0.1:11434');
  });
});

/**
 * Эмуляция /api/chat сервера Ollama: на каждый запрос отдаёт следующий заранее заданный
 * tool call потоком NDJSON — в том формате, который разбирает ChatOllama.
 */
function fakeOllamaFetch(turns) {
  const requests = [];
  const fetchImpl = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    const next = turns[requests.length - 1];
    // Ход может зависеть от истории (например, id задачи из результата предыдущего tool).
    const turn = typeof next === 'function' ? next(body) : next;
    const chunks = [
      {
        model: body.model,
        created_at: '2026-10-06T00:00:00Z',
        message: { role: 'assistant', content: '', tool_calls: [{ function: { name: turn.name, arguments: turn.args } }] },
        done: false,
      },
      { model: body.model, created_at: '2026-10-06T00:00:01Z', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 },
    ];
    return new Response(chunks.map((chunk) => `${JSON.stringify(chunk)}\n`).join(''), {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  });
  return { fetchImpl, requests };
}

describe('createAgent + ChatOllama (toolStrategy) с эмуляцией Ollama', () => {
  let server;

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('выполняет tool call через HTTP API и возвращает structuredResponse контракта', async () => {
    server = await new Promise((resolve) => {
      const instance = createApp({ store: createTaskStore() }).listen(0, '127.0.0.1', () => resolve(instance));
    });
    const apiBaseUrl = `http://127.0.0.1:${server.address().port}`;
    const stats = { total: 0, byStatus: { pending: 0, in_progress: 0, done: 0 } };
    const { fetchImpl, requests } = fakeOllamaFetch([
      { name: 'get_task_stats', args: {} },
      { name: RESPONSE_TOOL_NAME, args: { status: 'success', action: 'get_task_stats', data: stats, errors: [] } },
    ]);
    const config = loadConfig({ OLLAMA_BASE_URL: 'http://ollama.test:11434', OLLAMA_MODEL: 'qwen3:8b', API_BASE_URL: apiBaseUrl });
    const toolLogger = { info: vi.fn() };
    const { agent } = createConfiguredTaskAgent(config, { logger: toolLogger, fetchImpl });

    const result = await runTaskAgent({ agent, userInput: 'покажи статистику задач', logger: silentLogger() });

    expect(result).toEqual({ status: 'success', action: 'get_task_stats', data: stats, errors: [] });
    expect(toolLogger.info.mock.calls[0][0]).toContain(`[tool:get_task_stats] GET ${apiBaseUrl}/tasks/stats -> HTTP 200`);

    // Запросы ушли в /api/chat заданного Ollama с моделью, temperature 0 и всеми tools, включая инструмент ответа.
    expect(requests).toHaveLength(2);
    const [first] = requests;
    expect(first.url).toBe('http://ollama.test:11434/api/chat');
    expect(first.body.model).toBe('qwen3:8b');
    expect(first.body.options.temperature).toBe(0);
    expect(first.body.think).toBe(false);
    expect(first.body.options.num_ctx).toBe(8192);
    expect(first.body.tools.map((t) => t.function.name)).toEqual([
      'create_task',
      'get_task',
      'update_task_status',
      'get_task_stats',
      RESPONSE_TOOL_NAME,
    ]);
    expect(first.body.messages.at(-1)).toMatchObject({ role: 'user', content: 'покажи статистику задач' });
    // Запрос к модели ограничен таймаутом.
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('multiple: модель перечисляет шаги без данных, runTaskAgent подставляет результаты HTTP API', async () => {
    server = await new Promise((resolve) => {
      const instance = createApp({ store: createTaskStore() }).listen(0, '127.0.0.1', () => resolve(instance));
    });
    const lastToolResult = (body) => JSON.parse(body.messages.findLast((m) => m.role === 'tool').content);
    const { fetchImpl } = fakeOllamaFetch([
      { name: 'create_task', args: { title: 'Купить молоко' } },
      (body) => ({ name: 'update_task_status', args: { id: lastToolResult(body).data.id, status: 'in_progress' } }),
      {
        name: RESPONSE_TOOL_NAME,
        args: {
          status: 'success',
          action: 'multiple',
          data: { steps: [{ action: 'create_task', status: 'success' }, { action: 'update_task_status', status: 'success' }] },
          errors: [],
        },
      },
    ]);
    const config = loadConfig({ API_BASE_URL: `http://127.0.0.1:${server.address().port}` });
    const { agent } = createConfiguredTaskAgent(config, { logger: { info: vi.fn() }, fetchImpl });

    const result = await runTaskAgent({ agent, userInput: 'создай задачу Купить молоко и начни работу над ней', logger: silentLogger() });

    expect(result.status).toBe('success');
    expect(result.action).toBe('multiple');
    const [created, updated] = result.data.steps;
    expect(created).toMatchObject({ action: 'create_task', status: 'success', data: { title: 'Купить молоко', status: 'pending' }, errors: [] });
    expect(updated).toMatchObject({ action: 'update_task_status', status: 'success', data: { id: created.data.id, status: 'in_progress' }, errors: [] });
  });

  // Ответ Ollama без tool calls: обычный текст (и, при включённом thinking, отдельное поле thinking).
  const textOnlyTurn = (content, thinking) => ({ content, thinking });

  async function runWithOllamaTurns(turns, userInput) {
    server = await new Promise((resolve) => {
      const instance = createApp({ store: createTaskStore() }).listen(0, '127.0.0.1', () => resolve(instance));
    });
    let call = 0;
    const fetchImpl = vi.fn(async (url, init) => {
      const { model } = JSON.parse(init.body);
      const turn = turns[call++];
      const message = turn.name
        ? { role: 'assistant', content: '', tool_calls: [{ function: { name: turn.name, arguments: turn.args } }] }
        : { role: 'assistant', content: turn.content, ...(turn.thinking ? { thinking: turn.thinking } : {}) };
      const chunk = { model, created_at: '2026-10-06T00:00:00Z', message, done: true, done_reason: 'stop' };
      return new Response(`${JSON.stringify(chunk)}\n`, { status: 200 });
    });
    const config = loadConfig({ API_BASE_URL: `http://127.0.0.1:${server.address().port}` });
    const { agent } = createConfiguredTaskAgent(config, { logger: { info: vi.fn() }, fetchImpl });
    return runTaskAgent({ agent, userInput, logger: silentLogger() });
  }

  it('оборачивает текстовый ответ модели без вызова tools в контракт error/none, без thinking', async () => {
    const result = await runWithOllamaTurns(
      [textOnlyTurn('Удаление задач не поддерживается.', 'Пользователь просит удалить — внутреннее рассуждение')],
      'удали все задачи',
    );

    expect(result).toEqual({ status: 'error', action: 'none', data: null, errors: ['Удаление задач не поддерживается.'] });
    expect(JSON.stringify(result)).not.toContain('рассуждение');
  });

  it('не маскирует текстом ответ после вызова task tool без structuredResponse', async () => {
    const result = await runWithOllamaTurns(
      [{ name: 'get_task_stats', args: {} }, textOnlyTurn('Всего задач: 0')],
      'покажи статистику задач',
    );

    expect(result.status).toBe('error');
    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/не выполнила требуемый tool calling/);
    expect(result.errors[0]).not.toContain('Всего задач');
  });
});
