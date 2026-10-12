import { describe, expect, it } from 'vitest';
import { agentResponseSchema, finalizeAgentResponse, modelResponseSchema, RESPONSE_TOOL_NAME } from '../src/agent/response-schema.js';
import { toJSONSchema } from 'zod';

const task = {
  id: 'Подготовить отчёт',
  title: 'Подготовить отчёт',
  status: 'pending',
  createdAt: '2026-10-06T18:00:00.000Z',
  updatedAt: '2026-10-06T18:00:00.000Z',
};
const stats = { total: 1, byStatus: { pending: 1, in_progress: 0, done: 0 } };

describe('agentResponseSchema', () => {
  it.each([
    ['задача', { status: 'success', action: 'create_task', data: task, errors: [] }],
    ['статистика', { status: 'success', action: 'get_task_stats', data: stats, errors: [] }],
    [
      'несколько действий',
      {
        status: 'success',
        action: 'multiple',
        data: {
          steps: [
            { action: 'create_task', status: 'success', data: task, errors: [] },
            { action: 'update_task_status', status: 'success', data: { ...task, status: 'in_progress' }, errors: [] },
          ],
        },
        errors: [],
      },
    ],
    ['ответ без tools', { status: 'success', action: 'none', data: { message: 'Я умею создавать задачи.' }, errors: [] }],
  ])('принимает корректный success: %s', (_, response) => {
    expect(agentResponseSchema.parse(response)).toEqual(response);
  });

  it('принимает корректный error', () => {
    const response = { status: 'error', action: 'get_task', data: null, errors: ['Нужен ID задачи'] };
    expect(agentResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    ['success с непустыми errors', { status: 'success', action: 'create_task', data: task, errors: ['ошибка'] }],
    ['error с ненулевой data', { status: 'error', action: 'create_task', data: task, errors: ['ошибка'] }],
    ['error без сообщений', { status: 'error', action: 'none', data: null, errors: [] }],
    ['data не соответствует action', { status: 'success', action: 'get_task_stats', data: task, errors: [] }],
    ['success без data', { status: 'success', action: 'get_task', data: null, errors: [] }],
    ['неизвестный action', { status: 'success', action: 'delete_task', data: null, errors: [] }],
    ['лишнее поле', { status: 'error', action: 'none', data: null, errors: ['x'], message: 'hi' }],
    ['произвольная data', { status: 'success', action: 'none', data: { foo: 1 }, errors: [] }],
  ])('отклоняет противоречивый ответ: %s', (_, response) => {
    expect(agentResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('finalizeAgentResponse', () => {
  it('возвращает валидный ответ без изменений', () => {
    const response = { status: 'success', action: 'get_task_stats', data: stats, errors: [] };
    expect(finalizeAgentResponse(response)).toEqual(response);
  });

  it('превращает невалидный ответ в error контракта и сообщает о проблемах', () => {
    const problems = [];

    const result = finalizeAgentResponse(
      { status: 'success', action: 'create_task', data: task, errors: ['x'] },
      { onInvalid: (list) => problems.push(...list) },
    );

    expect(result).toMatchObject({ status: 'error', action: 'none', data: null });
    expect(result.errors[0]).toMatch(/не соответствующий контракту/);
    expect(problems).toEqual(['errors: при status success массив errors должен быть пустым']);
  });
});

describe('modelResponseSchema (схема task_agent_response для модели)', () => {
  const steps = [
    { action: 'create_task', status: 'success' },
    { action: 'update_task_status', status: 'success' },
  ];

  it('для multiple принимает шаги только с action и status', () => {
    const response = { status: 'success', action: 'multiple', data: { steps }, errors: [] };
    expect(modelResponseSchema.parse(response)).toEqual(response);
  });

  it('для multiple отклоняет шаги с копиями данных задач', () => {
    const response = {
      status: 'success',
      action: 'multiple',
      data: { steps: steps.map((step) => ({ ...step, data: task, errors: [] })) },
      errors: [],
    };
    expect(modelResponseSchema.safeParse(response).success).toBe(false);
  });

  it('одиночные действия совпадают с контрактом', () => {
    const response = { status: 'success', action: 'create_task', data: task, errors: [] };
    expect(modelResponseSchema.parse(response)).toEqual(response);
    expect(modelResponseSchema.safeParse({ ...response, errors: ['x'] }).success).toBe(false);
  });

  it('имеет имя инструмента и JSON Schema шага без data', () => {
    const json = JSON.stringify(toJSONSchema(modelResponseSchema));
    expect(toJSONSchema(modelResponseSchema).title).toBe(RESPONSE_TOOL_NAME);
    expect(json).toContain('"required":["action","status"]');
  });

  it('итоговый контракт не принимает упрощённые шаги', () => {
    expect(agentResponseSchema.safeParse({ status: 'success', action: 'multiple', data: { steps }, errors: [] }).success).toBe(false);
  });
});
