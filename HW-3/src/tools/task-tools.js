import { tool } from 'langchain';
import { z } from 'zod';
import { TASK_STATUSES } from '../api/task-store.js';
import { TITLE_MAX_LENGTH } from '../api/validation.js';
import { createApiClient, errorResult } from './api-client.js';

const taskId = z.uuid().describe('ID задачи в формате UUID, например Подготовить отчёт');
const taskStatus = z
  .enum(TASK_STATUSES)
  .describe('Новый статус: pending — ожидает, in_progress — в работе, done — выполнена');

/**
 * Отладочный вывод результата tool: имя tool, HTTP-метод и URL, код ответа и итоговый результат.
 * Секреты и заголовки сюда не передаются и не логируются.
 */
function logToolResult(logger, { toolName, input, method, url, httpStatus, result }) {
  logger.info(
    `[tool:${toolName}] ${method} ${url} -> HTTP ${httpStatus ?? 'n/a'}\n` +
      `  input:  ${JSON.stringify(input)}\n` +
      `  result: ${JSON.stringify(result)}`,
  );
}

/**
 * Создаёт LangChain tools для четырёх операций локального API задач.
 * Каждый tool выполняет реальный HTTP-запрос и возвращает JSON-строку контракта
 * { status, action, data, errors }.
 *
 * @param {object} options
 * @param {string} options.baseUrl базовый URL API (из config.api.baseUrl)
 * @param {typeof fetch} [options.fetchImpl]
 * @param {Pick<Console, 'info'>} [options.logger]
 * @param {number} [options.timeoutMs]
 */
export function createTaskTools({ baseUrl, fetchImpl = globalThis.fetch, logger = console, timeoutMs } = {}) {
  const client = createApiClient({ baseUrl, fetchImpl, timeoutMs });

  function apiTool({ name, description, schema, toRequest }) {
    return tool(
      async (input) => {
        const { method, path, body } = toRequest(input);
        let call;
        try {
          call = await client.request({ action: name, method, path, body });
        } catch (error) {
          // Страховка: клиент не должен бросать, но tool в любом случае возвращает контракт.
          call = { method, url: `${client.baseUrl}${path}`, httpStatus: null, result: errorResult(name, `Ошибка вызова API: ${error.message}`) };
        }
        logToolResult(logger, { toolName: name, input, ...call });
        return JSON.stringify(call.result);
      },
      { name, description, schema },
    );
  }

  return [
    apiTool({
      name: 'create_task',
      description:
        'Создаёт новую задачу с указанным названием (POST /tasks). Используй, когда пользователь просит ' +
        'создать, добавить или завести задачу. Требуется только название title. Новая задача всегда ' +
        'получает статус pending; чтобы задать другой статус, после создания вызови update_task_status. ' +
        'Не изменяет и не ищет существующие задачи.',
      schema: z.object({
        title: z
          .string()
          .trim()
          .min(1)
          .max(TITLE_MAX_LENGTH)
          .describe(`Название задачи, непустая строка до ${TITLE_MAX_LENGTH} символов`),
      }),
      toRequest: ({ title }) => ({ method: 'POST', path: '/tasks', body: { title } }),
    }),

    apiTool({
      name: 'get_task',
      description:
        'Возвращает одну задачу по её ID (GET /tasks/:id): название, статус, даты создания и изменения. ' +
        'Используй, когда пользователь спрашивает о конкретной задаче и известен её UUID. ' +
        'Не ищет задачи по названию и не возвращает список задач.',
      schema: z.object({ id: taskId }),
      toRequest: ({ id }) => ({ method: 'GET', path: `/tasks/${encodeURIComponent(id)}` }),
    }),

    apiTool({
      name: 'update_task_status',
      description:
        'Меняет статус существующей задачи по её ID (PATCH /tasks/:id/status). Используй, когда ' +
        'пользователь просит начать работу над задачей (in_progress), завершить её (done) или вернуть ' +
        'в ожидание (pending). Требуются UUID задачи и новый статус. Не меняет название и не создаёт задачи.',
      schema: z.object({ id: taskId, status: taskStatus }),
      toRequest: ({ id, status }) => ({
        method: 'PATCH',
        path: `/tasks/${encodeURIComponent(id)}/status`,
        body: { status },
      }),
    }),

    apiTool({
      name: 'get_task_stats',
      description:
        'Возвращает статистику по всем задачам (GET /tasks/stats): общее количество и количество ' +
        'в каждом статусе (pending, in_progress, done). Используй для вопросов «сколько задач», ' +
        '«сколько выполнено» и т. п. Аргументы не нужны. Не возвращает сами задачи.',
      schema: z.object({}),
      toRequest: () => ({ method: 'GET', path: '/tasks/stats' }),
    }),
  ];
}
