import { z } from 'zod';
import { TASK_STATUSES } from '../api/task-store.js';

export const TOOL_ACTIONS = Object.freeze(['create_task', 'get_task', 'update_task_status', 'get_task_stats']);
export const AGENT_ACTIONS = Object.freeze([...TOOL_ACTIONS, 'multiple', 'none']);

// Имя инструмента структурированного ответа, которое видит модель (toolStrategy берёт его из title).
export const RESPONSE_TOOL_NAME = 'task_agent_response';

const resultStatus = z.enum(['success', 'error']);
const errorsSchema = z.array(z.string()).describe('Пустой массив при success; понятные сообщения при error');

export const taskDataSchema = z
  .strictObject({
    id: z.string(),
    title: z.string(),
    status: z.enum(TASK_STATUSES),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .describe('Задача из результата create_task, get_task или update_task_status');

export const statsDataSchema = z
  .strictObject({
    total: z.number().int().min(0),
    byStatus: z.strictObject({
      pending: z.number().int().min(0),
      in_progress: z.number().int().min(0),
      done: z.number().int().min(0),
    }),
  })
  .describe('Статистика из результата get_task_stats');

export const stepSchema = z
  .strictObject({
    action: z.enum(TOOL_ACTIONS),
    status: resultStatus,
    data: z.union([taskDataSchema, statsDataSchema]).nullable(),
    errors: errorsSchema,
  })
  .describe('Результат одного вызова tool');

export const multipleDataSchema = z
  .strictObject({ steps: z.array(stepSchema).min(2) })
  .describe('Результаты нескольких последовательных вызовов tools, в порядке вызова');

// Модель для multiple перечисляет только шаги (action + status). Полные data/errors шагов
// подставляются в runTaskAgent из фактических результатов tools: глубоко вложенный JSON
// с копиями задач небольшие локальные модели генерируют с ошибками (теряют скобки).
export const modelStepSchema = z
  .strictObject({
    action: z.enum(TOOL_ACTIONS),
    status: resultStatus,
  })
  .describe('Один вызов tool: его имя и status из результата');

export const modelMultipleDataSchema = z
  .strictObject({ steps: z.array(modelStepSchema).min(2) })
  .describe('Шаги нескольких последовательных вызовов tools, в порядке вызова; данные задач не повторяй');

export const infoDataSchema = z
  .strictObject({ message: z.string().min(1) })
  .describe('Краткий ответ без вызова tools, например о возможностях агента');

const dataSchemasByAction = (multiple) => ({
  create_task: taskDataSchema,
  get_task: taskDataSchema,
  update_task_status: taskDataSchema,
  get_task_stats: statsDataSchema,
  multiple,
  none: infoDataSchema,
});

/** Общая структура ответа и правила согласованности полей; отличается только data для multiple. */
function buildResponseSchema(multiple) {
  const byAction = dataSchemasByAction(multiple);
  return z
    .strictObject({
      status: resultStatus,
      action: z.enum(AGENT_ACTIONS),
      data: z
        .union([taskDataSchema, statsDataSchema, multiple, infoDataSchema])
        .nullable()
        .describe('Данные результата; null при status error'),
      errors: errorsSchema,
    })
    .superRefine((response, ctx) => {
      if (response.status === 'success') {
        if (response.errors.length > 0) {
          ctx.addIssue({ code: 'custom', path: ['errors'], message: 'при status success массив errors должен быть пустым' });
        }
        if (response.data !== null && !byAction[response.action].safeParse(response.data).success) {
          ctx.addIssue({ code: 'custom', path: ['data'], message: `data не соответствует action ${response.action}` });
        }
        if (response.data === null && response.action !== 'none') {
          ctx.addIssue({ code: 'custom', path: ['data'], message: `при status success для action ${response.action} нужна data` });
        }
      } else {
        if (response.data !== null) {
          ctx.addIssue({ code: 'custom', path: ['data'], message: 'при status error data должна быть null' });
        }
        if (response.errors.length === 0) {
          ctx.addIssue({ code: 'custom', path: ['errors'], message: 'при status error нужен хотя бы один текст ошибки' });
        }
      }
    });
}

/**
 * Контракт итогового ответа агента — то, что печатает CLI. Правила согласованности полей
 * (superRefine) проверяются в finalizeAgentResponse().
 */
export const agentResponseSchema = buildResponseSchema(multipleDataSchema);

/**
 * Схема инструмента task_agent_response, которую видит модель (toolStrategy). Совпадает
 * с контрактом, кроме multiple: шаги без data/errors — их подставляет runTaskAgent из результатов tools.
 * Структурная часть преобразуется в JSON Schema для модели; superRefine в неё не попадает.
 */
export const modelResponseSchema = buildResponseSchema(modelMultipleDataSchema).meta({
  title: RESPONSE_TOOL_NAME,
  description: 'Итоговый структурированный ответ агента. Вызывай последним, после получения результатов всех tools.',
});

export function agentErrorResult(errors, action = 'none') {
  return { status: 'error', action, data: null, errors: Array.isArray(errors) ? errors : [errors] };
}

/**
 * Финальная проверка ответа перед выводом. Невалидный ответ превращается в error-результат контракта.
 *
 * @param {unknown} candidate
 * @param {{ onInvalid?: (problems: string[]) => void, schema?: import('zod').ZodType }} [options] schema — по умолчанию итоговый контракт
 * @returns {{ status: 'success' | 'error', action: string, data: object | null, errors: string[] }}
 */
export function finalizeAgentResponse(candidate, { onInvalid, schema = agentResponseSchema } = {}) {
  const result = schema.safeParse(candidate);
  if (result.success) {
    return result.data;
  }
  const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'ответ'}: ${issue.message}`);
  onInvalid?.(details);
  return agentErrorResult([`Агент вернул ответ, не соответствующий контракту (${details.join('; ')})`]);
}
