import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createTaskStore } from '../src/api/task-store.js';

// Каждый тест получает своё приложение, своё хранилище и свой случайный порт.
async function startServer(options = {}) {
  const app = createApp({ store: createTaskStore(), ...options });
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve(instance)));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function stopServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

let server;
let baseUrl;

async function request(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

async function createTask(title) {
  const { body } = await request('POST', '/tasks', { title });
  return body.data;
}

function expectError(response, httpStatus, action) {
  expect(response.status).toBe(httpStatus);
  expect(response.body).toMatchObject({ status: 'error', action, data: null });
  expect(response.body.errors.length).toBeGreaterThan(0);
  expect(JSON.stringify(response.body)).not.toMatch(/at .+\.js:\d+/); // нет stack trace
}

beforeEach(async () => {
  ({ server, baseUrl } = await startServer());
});

afterEach(async () => {
  await stopServer(server);
});

describe('GET /health', () => {
  it('сообщает, что сервис работает', async () => {
    const response = await request('GET', '/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'success',
      action: 'health_check',
      data: { service: 'tasks-api', status: 'ok' },
      errors: [],
    });
  });
});

describe('POST /tasks', () => {
  it('создаёт задачу со статусом pending', async () => {
    const response = await request('POST', '/tasks', { title: '  Подготовить отчёт  ' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'success', action: 'create_task', errors: [] });
    expect(response.body.data).toMatchObject({ title: 'Подготовить отчёт', status: 'pending' });
    expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.data.createdAt).toBe(response.body.data.updatedAt);
  });

  it.each([
    ['пустой title', { title: '   ' }, 'title не может быть пустым'],
    ['title не строка', { title: 42 }, 'title должен быть строкой'],
    ['нет title', {}, 'title обязателен'],
    ['слишком длинный title', { title: 'x'.repeat(201) }, 'title не может быть длиннее 200 символов'],
    ['неизвестное поле', { title: 'Задача', priority: 'high' }, 'Неизвестные поля: priority'],
    ['тело не объект', ['Задача'], 'Тело запроса должно быть JSON-объектом'],
    ['некорректный JSON', '{"title":', 'Тело запроса содержит некорректный JSON'],
  ])('возвращает 400: %s', async (_, body, message) => {
    const response = await request('POST', '/tasks', body);

    expectError(response, 400, 'create_task');
    expect(response.body.errors).toContain(message);
  });
});

describe('GET /tasks/:id', () => {
  it('возвращает созданную задачу', async () => {
    const created = await createTask('Купить молоко');

    const response = await request('GET', `/tasks/${created.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'success', action: 'get_task', data: created, errors: [] });
  });

  it('возвращает 404 для отсутствующей задачи', async () => {
    const id = randomUUID();

    const response = await request('GET', `/tasks/${id}`);

    expectError(response, 404, 'get_task');
    expect(response.body.errors).toEqual([`Задача ${id} не найдена`]);
  });

  it('возвращает 400 для id не в формате UUID', async () => {
    const response = await request('GET', '/tasks/not-a-uuid');

    expectError(response, 400, 'get_task');
    expect(response.body.errors).toEqual(['id должен быть UUID']);
  });
});

describe('PATCH /tasks/:id/status', () => {
  it('изменяет статус задачи', async () => {
    const created = await createTask('Написать тесты');

    const response = await request('PATCH', `/tasks/${created.id}/status`, { status: 'in_progress' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'success',
      action: 'update_task_status',
      data: { id: created.id, title: 'Написать тесты', status: 'in_progress' },
      errors: [],
    });
    const stored = await request('GET', `/tasks/${created.id}`);
    expect(stored.body.data.status).toBe('in_progress');
  });

  it('возвращает 400 для недопустимого статуса и не меняет задачу', async () => {
    const created = await createTask('Написать тесты');

    const response = await request('PATCH', `/tasks/${created.id}/status`, { status: 'archived' });

    expectError(response, 400, 'update_task_status');
    expect(response.body.errors).toEqual(['status должен быть одним из: pending, in_progress, done']);
    const stored = await request('GET', `/tasks/${created.id}`);
    expect(stored.body.data.status).toBe('pending');
  });

  it('возвращает 404 для отсутствующей задачи', async () => {
    const response = await request('PATCH', `/tasks/${randomUUID()}/status`, { status: 'done' });

    expectError(response, 404, 'update_task_status');
  });
});

describe('GET /tasks/stats', () => {
  it('возвращает нули для пустого хранилища', async () => {
    const response = await request('GET', '/tasks/stats');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'success',
      action: 'get_task_stats',
      data: { total: 0, byStatus: { pending: 0, in_progress: 0, done: 0 } },
      errors: [],
    });
  });

  it('считает задачи по статусам после создания и обновления', async () => {
    const first = await createTask('Первая');
    const second = await createTask('Вторая');
    await createTask('Третья');
    await request('PATCH', `/tasks/${first.id}/status`, { status: 'in_progress' });
    await request('PATCH', `/tasks/${second.id}/status`, { status: 'done' });

    const response = await request('GET', '/tasks/stats');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ total: 3, byStatus: { pending: 1, in_progress: 1, done: 1 } });
  });
});

describe('ошибки', () => {
  it('возвращает 404 для неизвестного маршрута', async () => {
    const response = await request('GET', '/unknown');

    expectError(response, 404, 'unknown');
    expect(response.body.errors).toEqual(['Маршрут GET /unknown не найден']);
  });

  it('возвращает 500 без деталей при неожиданной ошибке', async () => {
    const failingStore = {
      ...createTaskStore(),
      stats() {
        throw new Error('секретная внутренняя деталь');
      },
    };
    const logger = { error: vi.fn() };
    const failing = await startServer({ store: failingStore, logger });

    try {
      const response = await fetch(`${failing.baseUrl}/tasks/stats`);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        status: 'error',
        action: 'get_task_stats',
        data: null,
        errors: ['Внутренняя ошибка сервера'],
      });
      expect(logger.error).toHaveBeenCalledOnce();
    } finally {
      await stopServer(failing.server);
    }
  });
});
