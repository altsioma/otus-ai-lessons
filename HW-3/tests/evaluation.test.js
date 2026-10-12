import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { OLLAMA_ERROR_CODES, OllamaError } from '../src/agent/ollama.js';
import { createApp } from '../src/api/app.js';
import { createTaskTools } from '../src/tools/task-tools.js';
import { createTraceLogger, explainsUnsupportedDeletion, parseTraceLine, runEvaluation, SCENARIOS, TASK_TITLE } from '../src/evaluation/run-evaluation.js';
import { renderEvaluationMarkdown } from '../src/evaluation/render-report.js';

const config = loadConfig({ OLLAMA_BASE_URL: 'http://ollama.test:11434', OLLAMA_MODEL: 'qwen3:8b', API_BASE_URL: 'http://unused.invalid' });
// Preflight без сети: Ollama «доступен», модель «установлена».
const preflightOk = vi.fn(async ({ baseUrl, model }) => ({ baseUrl, model, version: '0.0.0-test', capabilities: ['tools'] }));
const silent = { error: () => {}, warn: () => {}, debug: () => {} };
const UUID = '[0-9a-f-]{36}';

/**
 * Управляемая замена LLM: по тексту запроса вызывает настоящие HTTP tools (через временный API runner'а)
 * и возвращает контракт агента. overrides позволяют внести ошибку в конкретный сценарий.
 */
function scriptedAgent(overrides = {}) {
  const calls = { createAgent: [], requests: [] };

  const createAgentImpl = (evalConfig, { logger }) => {
    calls.createAgent.push(evalConfig);
    const tools = Object.fromEntries(createTaskTools({ baseUrl: evalConfig.api.baseUrl, logger }).map((t) => [t.name, t]));
    return { agent: { tools } };
  };

  const runAgentImpl = async ({ agent, userInput }) => {
    calls.requests.push(userInput);
    const { tools } = agent;
    const call = async (name, input) => JSON.parse(await tools[name].invoke(input));
    let match;
    if ((match = /^создай задачу (.+)$/.exec(userInput))) {
      return overrides.create ? overrides.create(call, match[1]) : call('create_task', { title: match[1] });
    }
    if ((match = new RegExp(`^покажи задачу (${UUID})$`).exec(userInput))) {
      return overrides.get ? overrides.get(call, match[1]) : call('get_task', { id: match[1] });
    }
    if ((match = new RegExp(`^отметь задачу (${UUID}) как выполненную$`).exec(userInput))) {
      return overrides.update ? overrides.update(call, match[1]) : call('update_task_status', { id: match[1], status: 'done' });
    }
    if (userInput === 'покажи статистику задач') {
      return overrides.stats ? overrides.stats(call) : call('get_task_stats', {});
    }
    return overrides.unsupported
      ? overrides.unsupported(call)
      : { status: 'error', action: 'none', data: null, errors: ['Удаление задач не поддерживается'] };
  };

  return { calls, createAgentImpl, runAgentImpl };
}

const run = (agent, extra = {}) => runEvaluation({ config, logger: silent, preflightImpl: preflightOk, ...agent, ...extra });
const byNumber = (report, n) => report.scenarios.find((s) => s.number === n);

let fetchSpy;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  // Ни один запрос не уходит за пределы loopback: ни к Ollama, ни во внешнюю сеть.
  for (const [url] of fetchSpy.mock.calls) {
    expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  }
  vi.restoreAllMocks();
});

describe('runEvaluation', () => {
  it('выполняет ровно пять сценариев и все проходят при корректном поведении', async () => {
    const agent = scriptedAgent();

    const report = await run(agent);

    expect(SCENARIOS).toHaveLength(5);
    expect(report.total).toBe(5);
    expect(agent.calls.requests).toHaveLength(5);
    expect(report.scenarios.map((s) => [s.number, s.passed, s.reasons])).toEqual([
      [1, true, []],
      [2, true, []],
      [3, true, []],
      [4, true, []],
      [5, true, []],
    ]);
    expect(report.passed).toBe(5);
    expect(report.model).toBe('qwen3:8b');
    expect(report.ollama).toEqual({ baseUrl: 'http://ollama.test:11434', version: '0.0.0-test' });
    expect(preflightOk).toHaveBeenCalledWith({ baseUrl: 'http://ollama.test:11434', model: 'qwen3:8b' });
  });

  it('подставляет фактический ID из сценария 1 в запросы 2 и 3', async () => {
    const agent = scriptedAgent();

    const report = await run(agent);

    const id = byNumber(report, 1).result.data.id;
    expect(agent.calls.requests).toEqual([
      `создай задачу ${TASK_TITLE}`,
      `покажи задачу ${id}`,
      `отметь задачу ${id} как выполненную`,
      'покажи статистику задач',
      'удали все задачи',
    ]);
  });

  it('направляет агента на временный API и сохраняет trace по сценариям', async () => {
    const agent = scriptedAgent();

    const report = await run(agent);

    expect(agent.calls.createAgent).toHaveLength(1);
    expect(agent.calls.createAgent[0].api.baseUrl).toBe(report.apiBaseUrl);
    expect(agent.calls.createAgent[0].ollama).toEqual(config.ollama);
    const id = byNumber(report, 1).result.data.id;
    expect(report.scenarios.map((s) => s.trace.map((c) => `${c.method} ${c.path} ${c.httpStatus}`))).toEqual([
      ['POST /tasks 201'],
      [`GET /tasks/${id} 200`],
      [`PATCH /tasks/${id}/status 200`],
      ['GET /tasks/stats 200'],
      [],
    ]);
    expect(byNumber(report, 1).traceLines[0]).toMatch(/^\[tool:create_task\] POST http:\/\/127\.0\.0\.1:\d+\/tasks -> HTTP 201/);
  });

  it('фиксирует FAIL при неправильном action', async () => {
    const agent = scriptedAgent({
      get: async (call, id) => ({ ...(await call('get_task', { id })), action: 'get_task_stats' }),
    });

    const report = await run(agent);

    expect(byNumber(report, 2).passed).toBe(false);
    expect(byNumber(report, 2).reasons).toContain('action = get_task_stats, ожидался get_task');
  });

  it('фиксирует FAIL при неправильном HTTP-методе в trace', async () => {
    const agent = scriptedAgent({
      // Модель «получает» задачу через PATCH вместо GET, но сообщает action get_task.
      get: async (call, id) => ({ ...(await call('update_task_status', { id, status: 'pending' })), action: 'get_task' }),
    });

    const report = await run(agent);

    const reasons = byNumber(report, 2).reasons;
    expect(byNumber(report, 2).passed).toBe(false);
    expect(reasons).toContain('в trace нет вызова get_task: GET /tasks/:id');
    expect(reasons.some((r) => r.startsWith('неожиданные HTTP-вызовы: update_task_status PATCH'))).toBe(true);
  });

  it('фиксирует FAIL, если статус не изменён и статистика не отражает выполненную задачу', async () => {
    const agent = scriptedAgent({
      // Модель выдумывает успех без вызова tool.
      update: async (call, id) => ({
        status: 'success',
        action: 'update_task_status',
        data: { id, title: TASK_TITLE, status: 'done', createdAt: 'x', updatedAt: 'x' },
        errors: [],
      }),
    });

    const report = await run(agent);

    expect(byNumber(report, 3).passed).toBe(false);
    expect(byNumber(report, 3).reasons).toContain('в trace нет вызова update_task_status: PATCH /tasks/:id/status');
    expect(byNumber(report, 4).passed).toBe(false);
    expect(byNumber(report, 4).reasons[0]).toMatch(/не отражает созданную задачу как done/);
  });

  it('фиксирует FAIL, если в сценарии 5 вызван tool', async () => {
    const agent = scriptedAgent({
      unsupported: async (call) => {
        await call('get_task_stats', {});
        return { status: 'error', action: 'none', data: null, errors: ['Удаление не поддерживается'] };
      },
    });

    const report = await run(agent);

    expect(byNumber(report, 5).passed).toBe(false);
    expect(byNumber(report, 5).reasons[0]).toMatch(/^вызваны tools, хотя не должны: get_task_stats GET \/tasks\/stats/);
  });

  it('фиксирует FAIL сценария 5, если errors содержат техническую ошибку tool calling', async () => {
    const technical =
      'Локальная модель не выполнила требуемый tool calling: вместо вызова task_agent_response она ответила текстом. Повторите запрос или выберите в OLLAMA_MODEL модель с более надёжной поддержкой tools.';
    const agent = scriptedAgent({
      unsupported: async () => ({ status: 'error', action: 'none', data: null, errors: [technical] }),
    });

    const report = await run(agent);

    expect(byNumber(report, 5).passed).toBe(false);
    expect(byNumber(report, 5).reasons[0]).toMatch(/^errors не объясняют, что удаление не поддерживается/);
  });

  it('не отправляет запросы 2 и 3, если сценарий 1 не вернул ID', async () => {
    const agent = scriptedAgent({
      create: async () => ({ status: 'error', action: 'create_task', data: null, errors: ['API недоступен'] }),
    });

    const report = await run(agent);

    expect(agent.calls.requests).toEqual([`создай задачу ${TASK_TITLE}`, 'покажи статистику задач', 'удали все задачи']);
    expect(byNumber(report, 2)).toMatchObject({ request: null, passed: false, reasons: ['пропущен: сценарий 1 не вернул ID задачи'] });
    expect(byNumber(report, 3).passed).toBe(false);
    expect(report.passed).toBe(1);
  });

  it.each([
    ['Ollama недоступен', new OllamaError(OLLAMA_ERROR_CODES.unavailable, 'Ollama не запущен или недоступен')],
    ['модель не установлена', new OllamaError(OLLAMA_ERROR_CODES.modelNotFound, 'Установите её командой: ollama pull qwen3:8b')],
  ])('не запускает API и сценарии, если preflight не прошёл: %s', async (_, error) => {
    const createAppImpl = vi.fn(createApp);
    const agent = scriptedAgent();

    await expect(run(agent, { createAppImpl, preflightImpl: vi.fn().mockRejectedValue(error) })).rejects.toBe(error);
    expect(createAppImpl).not.toHaveBeenCalled();
    expect(agent.calls.createAgent).toHaveLength(0);
    expect(agent.calls.requests).toHaveLength(0);
  });

  it('закрывает сервер, даже если выполнение запроса бросило исключение', async () => {
    let server;
    const createAppImpl = (options) => {
      const app = createApp(options);
      const listen = app.listen.bind(app);
      app.listen = (...args) => (server = listen(...args));
      return app;
    };
    const agent = scriptedAgent();
    agent.runAgentImpl = async () => {
      throw new Error('boom');
    };

    await expect(run(agent, { createAppImpl })).rejects.toThrow('boom');
    expect(server.listening).toBe(false);
  });
});

describe('explainsUnsupportedDeletion', () => {
  it.each([
    [['Удаление задач не поддерживается'], true],
    [['Удаление задач не поддерживается.'], true],
    [['Я не могу удалить задачи: такого действия нет.'], true],
    [['Удаление недоступно'], true],
    [['Действие не поддерживается'], false],
    [['Произошла ошибка'], false],
    [['Локальная модель не выполнила требуемый tool calling: удаление не поддерживается моделью'], false],
    [[], false],
    [undefined, false],
  ])('%j → %s', (errors, expected) => {
    expect(explainsUnsupportedDeletion(errors)).toBe(expected);
  });
});

describe('trace logger', () => {
  it('сохраняет строки, дублирует их в echo и очищается', () => {
    const echo = vi.fn();
    const logger = createTraceLogger({ echo });

    logger.info('[tool:get_task_stats] GET http://127.0.0.1:1/tasks/stats -> HTTP 200');
    expect(logger.lines).toHaveLength(1);
    expect(echo).toHaveBeenCalledOnce();
    logger.clear();
    expect(logger.lines).toEqual([]);
  });

  it('разбирает строку лога tool', () => {
    expect(parseTraceLine('[tool:get_task] GET http://127.0.0.1:5/tasks/abc -> HTTP n/a\n  input: {}')).toMatchObject({
      tool: 'get_task',
      method: 'GET',
      path: '/tasks/abc',
      httpStatus: null,
    });
    expect(parseTraceLine('просто текст')).toBeNull();
  });
});

describe('renderEvaluationMarkdown', () => {
  it('содержит модель Ollama, сводку, ответы и trace', async () => {
    const report = await run(scriptedAgent());

    const markdown = renderEvaluationMarkdown(report, {
      nodeVersion: 'v-test',
      packageVersions: { langchain: '1.0.0-test', '@langchain/ollama': '1.0.0-test' },
    });

    expect(markdown).toContain('локальной моделью Ollama');
    expect(markdown).toContain('| Модель (`OLLAMA_MODEL`) | `qwen3:8b` |');
    expect(markdown).toContain('`http://ollama.test:11434`, версия 0.0.0-test');
    expect(markdown).toContain('`@langchain/ollama` 1.0.0-test');
    expect(markdown).not.toMatch(/openai/i);
    expect(markdown).toContain('**5 из 5 сценариев PASS**');
    expect(markdown).toContain('[tool:create_task] POST');
    expect(markdown).toContain('**ни один task tool не вызван**');
    expect(markdown.match(/\*\*PASS\*\*/g)).toHaveLength(5);
  });
});
