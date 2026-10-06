import express from 'express';
import { createTaskStore } from './task-store.js';
import { ApiError, sendError, sendSuccess } from './responses.js';
import { createTaskSchema, formatZodError, taskIdSchema, updateStatusSchema } from './validation.js';

const jsonBody = express.json({ limit: '10kb' });

// Запоминает название операции, чтобы любой ответ (в том числе ошибка) содержал поле action.
const action = (name) => (req, res, next) => {
  res.locals.action = name;
  next();
};

function parse(schema, value) {
  const result = schema.safeParse(value, { reportInput: true });
  if (!result.success) {
    throw new ApiError(400, formatZodError(result.error));
  }
  return result.data;
}

/**
 * Создаёт Express-приложение API задач. Порт не открывается — это делает server.js.
 *
 * @param {object} [options]
 * @param {ReturnType<typeof createTaskStore>} [options.store] хранилище задач; по умолчанию новое в памяти
 * @param {Pick<Console, 'error'>} [options.logger] куда писать неожиданные ошибки
 */
export function createApp({ store = createTaskStore(), logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', action('health_check'), (req, res) => {
    sendSuccess(res, 200, { service: 'tasks-api', status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.post('/tasks', action('create_task'), jsonBody, (req, res) => {
    const { title } = parse(createTaskSchema, req.body);
    sendSuccess(res, 201, store.create({ title }));
  });

  // Объявлен до /tasks/:id, иначе "stats" было бы воспринято как id задачи.
  app.get('/tasks/stats', action('get_task_stats'), (req, res) => {
    sendSuccess(res, 200, store.stats());
  });

  app.get('/tasks/:id', action('get_task'), (req, res) => {
    const id = parse(taskIdSchema, req.params.id);
    const task = store.get(id);
    if (!task) {
      throw new ApiError(404, `Задача ${id} не найдена`);
    }
    sendSuccess(res, 200, task);
  });

  app.patch('/tasks/:id/status', action('update_task_status'), jsonBody, (req, res) => {
    const id = parse(taskIdSchema, req.params.id);
    const { status } = parse(updateStatusSchema, req.body);
    const task = store.updateStatus(id, status);
    if (!task) {
      throw new ApiError(404, `Задача ${id} не найдена`);
    }
    sendSuccess(res, 200, task);
  });

  app.use((req, res) => {
    sendError(res, 404, [`Маршрут ${req.method} ${req.path} не найден`]);
  });

  // Централизованный обработчик ошибок: клиент получает только понятное сообщение, без stack trace.
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return sendError(res, err.httpStatus, err.errors);
    }
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, ['Тело запроса содержит некорректный JSON']);
    }
    // Прочие клиентские ошибки body-parser (слишком большое тело, неподдерживаемая кодировка и т. п.).
    if (err.expose && err.status >= 400 && err.status < 500) {
      return sendError(res, err.status, [err.message]);
    }
    logger.error(err);
    return sendError(res, 500, ['Внутренняя ошибка сервера']);
  });

  return app;
}
