import { createApp } from '../api/app.js';
import { createTaskStore } from '../api/task-store.js';
import { createConfiguredTaskAgent } from '../agent/configured-agent.js';
import { checkOllama } from '../agent/ollama.js';
import { runTaskAgent } from '../agent/task-agent.js';

/**
 * Проверка текста ответа в сценарии 5 (только для оценки, не для маршрутизации запросов):
 * хотя бы одно сообщение говорит об удалении и о том, что оно не поддерживается/недоступно.
 * Технические сообщения о сбое tool calling объяснением не считаются.
 */
export function explainsUnsupportedDeletion(errors) {
  return (
    Array.isArray(errors) &&
    errors.some(
      (text) =>
        typeof text === 'string' &&
        !/tool calling|task_agent_response/i.test(text) &&
        /удал/i.test(text) &&
        /не поддерж|не доступ|недоступ|невозможн|нельзя|не могу|не умею|не предусмотр/i.test(text),
    )
  );
}

export const TASK_TITLE = 'Подготовить итоговый отчёт';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Пять обязательных сценариев. Сценарии 2 и 3 используют фактический data.id из сценария 1.
 * expectedCalls — ожидаемые HTTP-вызовы tools; пустой список означает, что tools вызываться не должны.
 */
export const SCENARIOS = Object.freeze([
  {
    number: 1,
    title: 'Создание задачи',
    request: () => `создай задачу ${TASK_TITLE}`,
    expectedAction: 'create_task',
    expectedCalls: () => [{ tool: 'create_task', method: 'POST', path: '/tasks', display: 'POST /tasks' }],
    check: ({ result }) => [
      result.data?.title === TASK_TITLE || `data.title = ${JSON.stringify(result.data?.title)}, ожидалось "${TASK_TITLE}"`,
      UUID_RE.test(result.data?.id ?? '') || 'data.id не является UUID',
      result.data?.status === 'pending' || `data.status = ${result.data?.status}, ожидалось pending`,
    ],
  },
  {
    number: 2,
    title: 'Получение созданной задачи',
    requiresTaskId: true,
    request: ({ taskId }) => `покажи задачу ${taskId}`,
    expectedAction: 'get_task',
    expectedCalls: ({ taskId }) => [
      { tool: 'get_task', method: 'GET', path: `/tasks/${taskId}`, display: 'GET /tasks/:id' },
    ],
    check: ({ result, taskId }) => [
      result.data?.id === taskId || `data.id = ${result.data?.id}, ожидался ID из сценария 1`,
    ],
  },
  {
    number: 3,
    title: 'Изменение статуса',
    requiresTaskId: true,
    request: ({ taskId }) => `отметь задачу ${taskId} как выполненную`,
    expectedAction: 'update_task_status',
    expectedCalls: ({ taskId }) => [
      { tool: 'update_task_status', method: 'PATCH', path: `/tasks/${taskId}/status`, display: 'PATCH /tasks/:id/status' },
    ],
    check: ({ result, taskId }) => [
      result.data?.id === taskId || `data.id = ${result.data?.id}, ожидался ID из сценария 1`,
      result.data?.status === 'done' || `data.status = ${result.data?.status}, ожидалось done`,
    ],
  },
  {
    number: 4,
    title: 'Статистика',
    request: () => 'покажи статистику задач',
    expectedAction: 'get_task_stats',
    expectedCalls: () => [{ tool: 'get_task_stats', method: 'GET', path: '/tasks/stats', display: 'GET /tasks/stats' }],
    // Хранилище создаётся заново для прогона, поэтому в нём ровно одна задача — выполненная.
    check: ({ result }) => {
      const expected = { total: 1, byStatus: { pending: 0, in_progress: 0, done: 1 } };
      return [
        JSON.stringify(result.data) === JSON.stringify(expected) ||
          `статистика ${JSON.stringify(result.data)} не отражает созданную задачу как done (ожидалось ${JSON.stringify(expected)})`,
      ];
    },
  },
  {
    number: 5,
    title: 'Неподдерживаемое действие',
    request: () => 'удали все задачи',
    expectedStatus: 'error',
    expectedAction: 'none',
    expectedCalls: () => [],
    check: ({ result }) => [
      result.data === null || 'data должна быть null',
      explainsUnsupportedDeletion(result.errors) ||
        `errors не объясняют, что удаление не поддерживается: ${JSON.stringify(result.errors ?? [])}`,
    ],
  },
]);

const TRACE_RE = /^\[tool:([\w-]+)\] (\S+) (\S+) -> HTTP (\S+)/;

/** Разбирает строку отладочного лога tool (формат logToolResult в src/tools/task-tools.js). */
export function parseTraceLine(line) {
  const match = TRACE_RE.exec(line);
  if (!match) {
    return null;
  }
  const [, tool, method, url, httpStatus] = match;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // оставляем URL как есть
  }
  return { tool, method, path, httpStatus: Number(httpStatus) || null, line };
}

/**
 * Logger для tools: сохраняет строки [tool:...] в памяти и при необходимости дублирует их в stderr.
 * Сам формат логирования tools не меняется.
 */
export function createTraceLogger({ echo } = {}) {
  let lines = [];
  return {
    info(message) {
      lines.push(String(message));
      echo?.(String(message));
    },
    clear() {
      lines = [];
    },
    get lines() {
      return [...lines];
    },
  };
}

function evaluateScenario(scenario, { result, trace, taskId }) {
  const reasons = [];
  const expectedStatus = scenario.expectedStatus ?? 'success';
  if (result.status !== expectedStatus) {
    reasons.push(`status = ${result.status}, ожидался ${expectedStatus}${result.errors?.length ? ` (${result.errors.join('; ')})` : ''}`);
  }
  if (result.action !== scenario.expectedAction) {
    reasons.push(`action = ${result.action}, ожидался ${scenario.expectedAction}`);
  }

  const expectedCalls = scenario.expectedCalls({ taskId });
  if (expectedCalls.length === 0) {
    if (trace.length > 0) {
      reasons.push(`вызваны tools, хотя не должны: ${trace.map((call) => `${call.tool} ${call.method} ${call.path}`).join(', ')}`);
    }
  } else {
    for (const expected of expectedCalls) {
      const matched = trace.filter((call) => call.tool === expected.tool && call.method === expected.method && call.path === expected.path);
      if (matched.length === 0) {
        reasons.push(`в trace нет вызова ${expected.tool}: ${expected.display}`);
      } else if (!matched.some((call) => call.httpStatus >= 200 && call.httpStatus < 300)) {
        reasons.push(`вызов ${expected.display} не вернул HTTP 2xx`);
      }
    }
    const unexpected = trace.filter(
      (call) => !expectedCalls.some((e) => e.tool === call.tool && e.method === call.method && e.path === call.path),
    );
    if (unexpected.length > 0) {
      reasons.push(`неожиданные HTTP-вызовы: ${unexpected.map((call) => `${call.tool} ${call.method} ${call.path}`).join(', ')}`);
    }
  }

  if (reasons.length === 0) {
    for (const outcome of scenario.check({ result, taskId })) {
      if (outcome !== true) {
        reasons.push(outcome);
      }
    }
  }
  return reasons;
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve(server)));
  });
}

/**
 * Последовательно выполняет пять сценариев против временного локального API.
 * Перед запуском API выполняется preflight Ollama: сервер доступен, модель установлена.
 * Все зависимости внедряются, поэтому runner тестируется без Ollama.
 *
 * @param {object} options
 * @param {ReturnType<import('../config.js').loadConfig>} options.config
 * @param {typeof checkOllama} [options.preflightImpl]
 * @param {typeof createConfiguredTaskAgent} [options.createAgentImpl]
 * @param {typeof runTaskAgent} [options.runAgentImpl]
 * @param {typeof createApp} [options.createAppImpl]
 * @param {(line: string) => void} [options.echo] вывод строк trace (например, в stderr)
 * @param {{ error: Function, warn?: Function, debug?: Function }} [options.logger] диагностика runTaskAgent
 * @param {() => Date} [options.now]
 */
export async function runEvaluation({
  config,
  preflightImpl = checkOllama,
  createAgentImpl = createConfiguredTaskAgent,
  runAgentImpl = runTaskAgent,
  createAppImpl = createApp,
  echo,
  logger = console,
  now = () => new Date(),
}) {
  // Ollama проверяется до запуска API: при недоступном сервере или отсутствующей модели
  // бросается OllamaError, и ни один сценарий не выполняется.
  const ollama = await preflightImpl({ baseUrl: config.ollama.baseUrl, model: config.ollama.model });

  const startedAt = now();
  const server = await listen(createAppImpl({ store: createTaskStore() }));
  try {
    const apiBaseUrl = `http://127.0.0.1:${server.address().port}`;
    const evalConfig = { ...config, api: { ...config.api, baseUrl: apiBaseUrl } };
    const traceLogger = createTraceLogger({ echo });
    const { agent } = createAgentImpl(evalConfig, { logger: traceLogger });

    const scenarios = [];
    let taskId = null;
    for (const scenario of SCENARIOS) {
      const base = {
        number: scenario.number,
        title: scenario.title,
        expectedAction: scenario.expectedAction,
        expectedStatus: scenario.expectedStatus ?? 'success',
        expectedCalls: scenario.expectedCalls({ taskId: taskId ?? ':id' }).map((call) => call.display),
      };
      if (scenario.requiresTaskId && !taskId) {
        // Без фактического ID из сценария 1 запрос не отправляется: выдумывать UUID нельзя.
        scenarios.push({ ...base, request: null, result: null, traceLines: [], trace: [], passed: false, reasons: ['пропущен: сценарий 1 не вернул ID задачи'] });
        continue;
      }

      const request = scenario.request({ taskId });
      traceLogger.clear();
      const result = await runAgentImpl({ agent, userInput: request, logger });
      const traceLines = traceLogger.lines;
      const trace = traceLines.map(parseTraceLine).filter(Boolean);
      const reasons = evaluateScenario(scenario, { result, trace, taskId });

      if (scenario.number === 1 && result.status === 'success' && UUID_RE.test(result.data?.id ?? '')) {
        taskId = result.data.id;
      }
      scenarios.push({ ...base, request, result, traceLines, trace, passed: reasons.length === 0, reasons });
    }

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
      model: config.ollama.model,
      ollama: { baseUrl: config.ollama.baseUrl, version: ollama?.version ?? null },
      apiBaseUrl,
      scenarios,
      passed: scenarios.filter((scenario) => scenario.passed).length,
      total: scenarios.length,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
