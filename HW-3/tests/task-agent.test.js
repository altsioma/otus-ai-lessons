import { randomUUID } from 'node:crypto';
import { AIMessage, FakeToolCallingModel, ToolMessage, ToolStrategy } from 'langchain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createTaskStore } from '../src/api/task-store.js';
import { RESPONSE_TOOL_NAME } from '../src/agent/response-schema.js';
import { createTaskAgent, MAX_FALLBACK_TEXT_LENGTH, runTaskAgent, visibleModelText } from '../src/agent/task-agent.js';
import { SYSTEM_PROMPT } from '../src/prompts/system-prompt.js';
import { createTaskTools } from '../src/tools/task-tools.js';

const task = {
  id: 'Подготовить отчёт',
  title: 'Подготовить отчёт',
  status: 'pending',
  createdAt: '2026-10-06T18:00:00.000Z',
  updatedAt: '2026-10-06T18:00:00.000Z',
};
const success = (action, data) => ({ status: 'success', action, data, errors: [] });
const toolMessage = (name, result) => new ToolMessage({ name, content: JSON.stringify(result), tool_call_id: `call_${name}` });
const silentLogger = () => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() });
const stubAgent = (state) => ({ invoke: vi.fn().mockResolvedValue(state) });

describe('createTaskAgent', () => {
  it('подключает system prompt, tools и response format', () => {
    const createAgentImpl = vi.fn().mockReturnValue({ invoke: vi.fn() });
    const model = { name: 'fake-model' };
    const tools = createTaskTools({ baseUrl: 'http://api.test' });

    createTaskAgent({ model, tools, createAgentImpl });

    expect(createAgentImpl).toHaveBeenCalledOnce();
    const params = createAgentImpl.mock.calls[0][0];
    expect(params.model).toBe(model);
    expect(params.tools).toBe(tools);
    expect(params.systemPrompt).toBe(SYSTEM_PROMPT);
    // toolStrategy() возвращает массив стратегий (по одной на схему).
    expect(params.responseFormat).toHaveLength(1);
    expect(params.responseFormat[0]).toBeInstanceOf(ToolStrategy);
    expect(params.responseFormat[0].name).toBe(RESPONSE_TOOL_NAME);
  });

  it('создаёт настоящего агента LangChain с invoke()', () => {
    const agent = createTaskAgent({
      model: new FakeToolCallingModel(),
      tools: createTaskTools({ baseUrl: 'http://api.test' }),
    });

    expect(typeof agent.invoke).toBe('function');
  });

  it('требует model и tools', () => {
    expect(() => createTaskAgent({ tools: [] })).toThrow(/model/);
    expect(() => createTaskAgent({ model: {}, tools: [] })).toThrow(/tools/);
  });
});

describe('runTaskAgent с заглушкой агента', () => {
  it('передаёт запрос пользователя в messages и возвращает structuredResponse', async () => {
    const response = success('get_task_stats', { total: 0, byStatus: { pending: 0, in_progress: 0, done: 0 } });
    const agent = stubAgent({
      messages: [toolMessage('get_task_stats', response)],
      structuredResponse: response,
    });

    const result = await runTaskAgent({ agent, userInput: '  покажи статистику  ', logger: silentLogger() });

    expect(agent.invoke).toHaveBeenCalledWith({ messages: [{ role: 'user', content: 'покажи статистику' }] });
    expect(result).toEqual(response);
  });

  it('не вызывает агента для пустого запроса', async () => {
    const agent = stubAgent({});

    const result = await runTaskAgent({ agent, userInput: '   ' });

    expect(agent.invoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'error', action: 'none', data: null });
  });

  it('сообщает, что модель не выполнила tool calling, если structuredResponse нет', async () => {
    const logger = silentLogger();

    const result = await runTaskAgent({ agent: stubAgent({ messages: [] }), userInput: 'привет', logger });

    expect(result).toMatchObject({ status: 'error', action: 'none', data: null });
    expect(result.errors).toEqual([
      `Локальная модель не выполнила требуемый tool calling: вместо вызова ${RESPONSE_TOOL_NAME} она ответила текстом. Повторите запрос или выберите в OLLAMA_MODEL модель с более надёжной поддержкой tools.`,
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  describe('текстовый ответ модели без structuredResponse', () => {
    const userMessage = { role: 'user', content: 'удали все задачи' };

    it('оборачивает «Удаление задач не поддерживается» в корректный контракт', async () => {
      const result = await runTaskAgent({
        agent: stubAgent({ messages: [userMessage, new AIMessage('Удаление задач не поддерживается')] }),
        userInput: 'удали все задачи',
        logger: silentLogger(),
      });

      expect(result).toEqual({ status: 'error', action: 'none', data: null, errors: ['Удаление задач не поддерживается'] });
    });

    it('не пропускает reasoning/thinking: ни блоки, ни теги <think>, ни reasoning_content', async () => {
      const message = new AIMessage({
        content: [
          { type: 'reasoning', reasoning: 'СЕКРЕТНОЕ рассуждение' },
          { type: 'thinking', thinking: 'СЕКРЕТНОЕ рассуждение 2' },
          { type: 'text', text: '<think>СЕКРЕТНОЕ рассуждение 3</think>Удаление задач   не поддерживается' },
        ],
        additional_kwargs: { reasoning_content: 'СЕКРЕТНОЕ рассуждение 4' },
      });

      const result = await runTaskAgent({ agent: stubAgent({ messages: [userMessage, message] }), userInput: 'удали', logger: silentLogger() });

      expect(result.errors).toEqual(['Удаление задач не поддерживается']);
      expect(JSON.stringify(result)).not.toContain('СЕКРЕТНОЕ');
    });

    it('ограничивает длину fallback-сообщения', async () => {
      const result = await runTaskAgent({
        agent: stubAgent({ messages: [userMessage, new AIMessage(`Удаление не поддерживается. ${'очень длинно '.repeat(200)}`)] }),
        userInput: 'удали',
        logger: silentLogger(),
      });

      expect(result.errors[0].length).toBe(MAX_FALLBACK_TEXT_LENGTH);
      expect(result.errors[0].endsWith('…')).toBe(true);
    });

    it('не маскирует отсутствие structuredResponse после вызова task tool', async () => {
      const toolCall = new AIMessage({ content: '', tool_calls: [{ name: 'create_task', args: { title: 'X' }, id: 'call_create_task' }] });
      const result = await runTaskAgent({
        agent: stubAgent({
          messages: [userMessage, toolCall, toolMessage('create_task', success('create_task', task)), new AIMessage('Задача создана')],
        }),
        userInput: 'создай задачу X',
        logger: silentLogger(),
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/^Локальная модель не выполнила требуемый tool calling/);
    });

    it('оставляет техническую ошибку, если видимого текста нет', async () => {
      const result = await runTaskAgent({
        agent: stubAgent({ messages: [userMessage, new AIMessage('<think>только рассуждение</think>  ')] }),
        userInput: 'удали',
        logger: silentLogger(),
      });

      expect(result.errors[0]).toMatch(/^Локальная модель не выполнила требуемый tool calling/);
    });

    it('visibleModelText: незакрытый <think> отбрасывается до конца текста', () => {
      expect(visibleModelText('Ответ <think>оборванное рассуждение')).toBe('Ответ');
      expect(visibleModelText(['Удаление ', { type: 'text', text: 'не поддерживается' }])).toBe('Удаление не поддерживается');
    });
  });

  const ollamaResponseError = (message, statusCode) =>
    Object.assign(new Error(message), { name: 'ResponseError', error: message, status_code: statusCode });

  it.each([
    [
      'Ollama не запущен',
      Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }),
      'Ollama не запущен или недоступен. Запустите сервер командой: ollama serve (адрес задаётся OLLAMA_BASE_URL).',
    ],
    [
      'модель не найдена',
      ollamaResponseError('model "qwen3:8b" not found, try pulling it first', 404),
      'Модель qwen3:8b не найдена в Ollama. Установите её командой: ollama pull qwen3:8b',
    ],
    [
      'превышено время ожидания',
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      'Превышено время ожидания ответа Ollama. Модель может ещё загружаться в память — повторите запрос или увеличьте OLLAMA_TIMEOUT_MS.',
    ],
    [
      'модель без tool calling',
      ollamaResponseError('registry.ollama.ai/library/gemma:2b does not support tools', 400),
      'Модель не поддерживает tool calling в Ollama. Выберите модель с поддержкой tools в OLLAMA_MODEL (например, qwen3:8b).',
    ],
  ])('превращает ошибку Ollama (%s) в понятный результат без stack trace', async (_, error, message) => {
    const logger = silentLogger();

    const result = await runTaskAgent({ agent: { invoke: vi.fn().mockRejectedValue(error) }, userInput: 'статистика', logger });

    expect(result).toEqual({ status: 'error', action: 'none', data: null, errors: [message] });
    expect(JSON.stringify(result)).not.toMatch(/\n\s+at /);
    expect(logger.debug).toHaveBeenCalledWith(error);
  });

  it('превращает неожиданную ошибку в общий текст и логирует её', async () => {
    const logger = silentLogger();

    const result = await runTaskAgent({
      agent: { invoke: vi.fn().mockRejectedValue(new TypeError('x is not a function')) },
      userInput: 'статистика',
      logger,
    });

    expect(result.errors).toEqual(['Не удалось выполнить запрос агентом из-за внутренней ошибки.']);
    expect(logger.error.mock.calls[0][0]).toContain('TypeError: x is not a function');
  });

  it('отклоняет structuredResponse, нарушающий контракт', async () => {
    const result = await runTaskAgent({
      agent: stubAgent({ messages: [], structuredResponse: { status: 'error', action: 'get_task', data: task, errors: ['x'] } }),
      userInput: 'покажи задачу',
      logger: silentLogger(),
    });

    expect(result.status).toBe('error');
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatch(/не соответствующий контракту/);
  });

  it('не принимает success без успешного вызова соответствующего tool', async () => {
    const result = await runTaskAgent({
      agent: stubAgent({ messages: [], structuredResponse: success('create_task', task) }),
      userInput: 'создай задачу',
      logger: silentLogger(),
    });

    expect(result).toEqual({
      status: 'error',
      action: 'create_task',
      data: null,
      errors: ['Агент сообщил об успехе без успешного вызова tool create_task'],
    });
  });

  it('берёт data из фактического результата tool, а не из пересказа модели', async () => {
    const logger = silentLogger();
    const agent = stubAgent({
      messages: [toolMessage('create_task', success('create_task', task))],
      structuredResponse: success('create_task', { ...task, id: '00000000-0000-4000-8000-000000000000' }),
    });

    const result = await runTaskAgent({ agent, userInput: 'создай задачу', logger });

    expect(result).toEqual(success('create_task', task));
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('runTaskAgent: multiple собирается из фактических результатов tools', () => {
  const updated = { ...task, status: 'in_progress', updatedAt: '2026-10-06T18:01:00.000Z' };
  const multipleClaim = (actions) => ({
    status: 'success',
    action: 'multiple',
    data: { steps: actions.map((action) => ({ action, status: 'success' })) },
    errors: [],
  });

  it('подставляет data и errors шагов из ToolMessage в порядке вызова', async () => {
    const result = await runTaskAgent({
      agent: stubAgent({
        messages: [
          toolMessage('create_task', success('create_task', task)),
          toolMessage('update_task_status', success('update_task_status', updated)),
        ],
        structuredResponse: multipleClaim(['create_task', 'update_task_status']),
      }),
      userInput: 'создай задачу и начни работу',
      logger: silentLogger(),
    });

    expect(result).toEqual({
      status: 'success',
      action: 'multiple',
      data: {
        steps: [
          { action: 'create_task', status: 'success', data: task, errors: [] },
          { action: 'update_task_status', status: 'success', data: updated, errors: [] },
        ],
      },
      errors: [],
    });
  });

  it('не принимает success, если один из tools вернул ошибку', async () => {
    const result = await runTaskAgent({
      agent: stubAgent({
        messages: [
          toolMessage('create_task', success('create_task', task)),
          toolMessage('update_task_status', { status: 'error', action: 'update_task_status', data: null, errors: ['Задача не найдена'] }),
        ],
        structuredResponse: multipleClaim(['create_task', 'update_task_status']),
      }),
      userInput: 'создай задачу и начни работу',
      logger: silentLogger(),
    });

    expect(result).toEqual({
      status: 'error',
      action: 'multiple',
      data: null,
      errors: ['Агент сообщил об успехе, но не все действия выполнены: update_task_status — Задача не найдена'],
    });
  });

  it('не принимает multiple, если фактически вызван один tool', async () => {
    const result = await runTaskAgent({
      agent: stubAgent({
        messages: [toolMessage('create_task', success('create_task', task))],
        structuredResponse: multipleClaim(['create_task', 'update_task_status']),
      }),
      userInput: 'создай задачу и начни работу',
      logger: silentLogger(),
    });

    expect(result).toMatchObject({ status: 'error', action: 'multiple', data: null });
    expect(result.errors[0]).toMatch(/фактически вызвал tools: 1/);
  });

  it('при расхождении перечня шагов использует фактические вызовы и предупреждает', async () => {
    const logger = silentLogger();
    const result = await runTaskAgent({
      agent: stubAgent({
        messages: [
          toolMessage('create_task', success('create_task', task)),
          toolMessage('update_task_status', success('update_task_status', updated)),
        ],
        structuredResponse: multipleClaim(['create_task', 'get_task']),
      }),
      userInput: 'создай задачу и начни работу',
      logger,
    });

    expect(result.data.steps.map((step) => step.action)).toEqual(['create_task', 'update_task_status']);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('createAgent + FakeToolCallingModel + настоящий HTTP API', () => {
  let server;
  let baseUrl;
  let toolLogger;

  beforeEach(async () => {
    server = await new Promise((resolve) => {
      const instance = createApp({ store: createTaskStore() }).listen(0, '127.0.0.1', () => resolve(instance));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    toolLogger = { info: vi.fn() };
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function fakeAgent(turns) {
    return createTaskAgent({
      model: new FakeToolCallingModel({ toolCalls: turns }),
      tools: createTaskTools({ baseUrl, logger: toolLogger }),
    });
  }

  it('выполняет tool call create_task через HTTP и возвращает structuredResponse', async () => {
    const agent = fakeAgent([
      [{ name: 'create_task', args: { title: 'Подготовить отчёт' }, id: 'call_1' }],
      // Модель «пересказывает» задачу с неверным id — runTaskAgent подставит фактический результат tool.
      [{ name: RESPONSE_TOOL_NAME, args: success('create_task', task), id: 'call_2' }],
    ]);

    const result = await runTaskAgent({ agent, userInput: 'создай задачу Подготовить отчёт', logger: silentLogger() });

    expect(result.status).toBe('success');
    expect(result.action).toBe('create_task');
    expect(result.data.title).toBe('Подготовить отчёт');
    expect(result.data.id).not.toBe(task.id);
    const stored = await (await fetch(`${baseUrl}/tasks/${result.data.id}`)).json();
    expect(stored.data).toEqual(result.data);
    expect(toolLogger.info.mock.calls[0][0]).toContain(`[tool:create_task] POST ${baseUrl}/tasks -> HTTP 201`);
  });

  it('сохраняет ошибку tool в итоговом ответе', async () => {
    const id = randomUUID();
    const agent = fakeAgent([
      [{ name: 'get_task', args: { id }, id: 'call_1' }],
      [{ name: RESPONSE_TOOL_NAME, args: { status: 'error', action: 'get_task', data: null, errors: [`Задача ${id} не найдена`] }, id: 'call_2' }],
    ]);

    const result = await runTaskAgent({ agent, userInput: `покажи задачу ${id}`, logger: silentLogger() });

    expect(result).toEqual({ status: 'error', action: 'get_task', data: null, errors: [`Задача ${id} не найдена`] });
    expect(toolLogger.info.mock.calls[0][0]).toContain('-> HTTP 404');
  });
});
