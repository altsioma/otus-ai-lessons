import { z } from 'zod';
import { TASK_STATUSES } from './task-store.js';

export const TITLE_MAX_LENGTH = 200;

export const createTaskSchema = z.strictObject({
  title: z
    .string({ error: 'title должен быть строкой' })
    .trim()
    .min(1, { error: 'title не может быть пустым' })
    .max(TITLE_MAX_LENGTH, { error: `title не может быть длиннее ${TITLE_MAX_LENGTH} символов` }),
});

export const updateStatusSchema = z.strictObject({
  status: z.enum(TASK_STATUSES, {
    error: `status должен быть одним из: ${TASK_STATUSES.join(', ')}`,
  }),
});

export const taskIdSchema = z.uuid({ error: 'id должен быть UUID' });

/**
 * Превращает ошибки zod в список понятных сообщений для поля `errors` ответа.
 */
export function formatZodError(error) {
  return error.issues.map((issue) => {
    if (issue.path.length === 0) {
      if (issue.code === 'unrecognized_keys') {
        return `Неизвестные поля: ${issue.keys.join(', ')}`;
      }
      if (issue.code === 'invalid_type') {
        return 'Тело запроса должно быть JSON-объектом';
      }
      return issue.message;
    }
    // Отсутствующее обязательное поле zod сообщает как invalid_type с input === undefined
    // (input доступен, только если разбор выполнен с { reportInput: true }).
    if (issue.code === 'invalid_type' && issue.input === undefined) {
      return `${issue.path.join('.')} обязателен`;
    }
    return issue.message;
  });
}
