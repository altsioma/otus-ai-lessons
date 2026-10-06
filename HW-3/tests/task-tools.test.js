import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { StructuredTool } from 'langchain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createTaskStore } from '../src/api/task-store.js';
import { createTaskTools } from '../src/tools/task-tools.js';

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = handler.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve(server)));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;

function toolsByName(options) {
  const logger = { info: vi.fn() };
  const tools = Object.fromEntries(createTaskTools({ logger, ...options }).map((t) => [t.name, t]));
  return { tools, logger };
}

const invoke = async (t, input) => JSON.parse(await t.invoke(input));

describe('task tools против настоящего API', () => {
  let server;
  let tools;
  let logger;

  beforeEach(async () => {
    // Своё приложение и своё хранилище на каждый тест.
    server = await listen(createApp({ store: createTaskStore() }));
    ({ tools, logger } = toolsByName({ baseUrl: urlOf(server) }));
  });

  afterEach(async () => {
    await close(server);
  });

  it('создаёт четыре настоящих LangChain tool', () => {
    expect(Object.keys(tools)).toEqual(['create_task', 'get_task', 'update_task_status', 'get_task_stats']);
    for (const t of Object.values(tools)) {
      expect(t).toBeInstanceOf(StructuredTool);
      expect(t.description.length).toBeGreaterThan(50);
    }
  });

  it('create_task создаёт задачу через HTTP и возвращает JSON-строку контракта', async () => {
    const raw = await tools.create_task.invoke({ title: 'Подготовить отчёт' });

    expect(typeof raw).toBe('string');
    const result = JSON.parse(raw);
    expect(result).toMatchObject({
      status: 'success',
      action: 'create_task',
      data: { title: 'Подготовить отчёт', status: 'pending' },
      errors: [],
    });
    // Задача действительно появилась в API.
    const response = await fetch(`${urlOf(server)}/tasks/${result.data.id}`);
    expect(response.status).toBe(200);
  });

  it('get_task возвращает созданную задачу', async () => {
    const created = await invoke(tools.create_task, { title: 'Купить молоко' });

    const result = await invoke(tools.get_task, { id: created.data.id });

    expect(result).toEqual({ status: 'success', action: 'get_task', data: created.data, errors: [] });
  });

  it('update_task_status меняет статус', async () => {
    const created = await invoke(tools.create_task, { title: 'Написать тесты' });

    const result = await invoke(tools.update_task_status, { id: created.data.id, status: 'done' });

    expect(result).toMatchObject({ status: 'success', action: 'update_task_status', data: { status: 'done' } });
    const stored = await invoke(tools.get_task, { id: created.data.id });
    expect(stored.data.status).toBe('done');
  });

  it('get_task_stats возвращает правильную статистику', async () => {
    const first = await invoke(tools.create_task, { title: 'Первая' });
    await invoke(tools.create_task, { title: 'Вторая' });
    await invoke(tools.update_task_status, { id: first.data.id, status: 'in_progress' });

    const result = await invoke(tools.get_task_stats, {});

    expect(result).toEqual({
      status: 'success',
      action: 'get_task_stats',
      data: { total: 2, byStatus: { pending: 1, in_progress: 1, done: 0 } },
      errors: [],
    });
  });

  it('возвращает ошибку 404 структурированно', async () => {
    const id = randomUUID();

    const result = await invoke(tools.get_task, { id });

    expect(result).toEqual({ status: 'error', action: 'get_task', data: null, errors: [`Задача ${id} не найдена`] });
  });

  it.each([
    ['create_task', { title: '   ' }],
    ['create_task', {}],
    ['get_task', { id: 'not-a-uuid' }],
    ['update_task_status', { id: randomUUID(), status: 'archived' }],
  ])('схема %s отклоняет невалидный вход %o без HTTP-запроса', async (name, input) => {
    await expect(tools[name].invoke(input)).rejects.toThrow(/did not match expected schema/);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('логирует имя tool, метод, URL и результат', async () => {
    const result = await invoke(tools.create_task, { title: 'Логирование' });

    expect(logger.info).toHaveBeenCalledOnce();
    const [message] = logger.info.mock.calls[0];
    expect(message).toContain('[tool:create_task]');
    expect(message).toContain(`POST ${urlOf(server)}/tasks -> HTTP 201`);
    expect(message).toContain(JSON.stringify(result));
  });
});

describe('task tools: ошибки транспорта и ответа', () => {
  it('возвращает ошибку 500 структурированно', async () => {
    const store = { ...createTaskStore(), stats: () => { throw new Error('boom'); } };
    const server = await listen(createApp({ store, logger: { error: () => {} } }));
    try {
      const { tools } = toolsByName({ baseUrl: urlOf(server) });

      const result = await invoke(tools.get_task_stats, {});

      expect(result).toEqual({
        status: 'error',
        action: 'get_task_stats',
        data: null,
        errors: ['Внутренняя ошибка сервера'],
      });
    } finally {
      await close(server);
    }
  });

  it('возвращает ошибку соединения структурированно', async () => {
    // Занимаем свободный порт и сразу освобождаем его: на нём гарантированно никто не слушает.
    const probe = await listen(createServer());
    const baseUrl = urlOf(probe);
    await close(probe);
    const { tools, logger } = toolsByName({ baseUrl });

    const result = await invoke(tools.get_task_stats, {});

    expect(result.status).toBe('error');
    expect(result.data).toBeNull();
    expect(result.errors[0]).toMatch(/^Не удалось соединиться с API http:\/\/127\.0\.0\.1:\d+: ECONNREFUSED$/);
    expect(logger.info.mock.calls[0][0]).toContain(`GET ${baseUrl}/tasks/stats -> HTTP n/a`);
  });

  it.each([
    ['не JSON', 200, 'text/html', '<h1>Hello</h1>', 'API вернул ответ не в формате JSON (HTTP 200)'],
    ['неожиданная структура', 200, 'application/json', '{"ok":true}', 'API вернул ответ неожиданной структуры (HTTP 200)'],
    [
      'success при HTTP-ошибке',
      502,
      'application/json',
      '{"status":"success","action":"x","data":{},"errors":[]}',
      'API вернул ответ неожиданной структуры (HTTP 502)',
    ],
  ])('обрабатывает ответ: %s', async (_, httpStatus, contentType, body, message) => {
    const server = await listen(
      createServer((req, res) => {
        res.writeHead(httpStatus, { 'Content-Type': contentType });
        res.end(body);
      }),
    );
    try {
      const { tools } = toolsByName({ baseUrl: urlOf(server) });

      const result = await invoke(tools.get_task_stats, {});

      expect(result).toEqual({ status: 'error', action: 'get_task_stats', data: null, errors: [message] });
    } finally {
      await close(server);
    }
  });

  it('сохраняет дополнительные поля корректного ответа API', async () => {
    const payload = { status: 'success', action: 'get_task_stats', data: { total: 0 }, errors: [], meta: { v: 1 } };
    const server = await listen(
      createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      }),
    );
    try {
      const { tools } = toolsByName({ baseUrl: urlOf(server) });

      expect(await invoke(tools.get_task_stats, {})).toEqual(payload);
    } finally {
      await close(server);
    }
  });

  it('использует переданный fetchImpl и не бросает исключение, если он падает', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));
    const { tools } = toolsByName({ baseUrl: 'http://api.test', fetchImpl });

    const result = await invoke(tools.get_task, { id: randomUUID() });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: 'error',
      action: 'get_task',
      data: null,
      errors: ['Не удалось соединиться с API http://api.test: network down'],
    });
  });
});
