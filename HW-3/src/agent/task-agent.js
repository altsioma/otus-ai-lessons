import { AIMessage, createAgent, ToolMessage, toolStrategy } from 'langchain';
import { SYSTEM_PROMPT } from '../prompts/system-prompt.js';
import { renderUserPrompt } from '../prompts/user-prompt.js';
import { toOllamaError } from './ollama.js';
import { agentErrorResult, finalizeAgentResponse, modelResponseSchema, RESPONSE_TOOL_NAME, TOOL_ACTIONS } from './response-schema.js';

/**
 * Собирает LangChain-агента. Модель и tools передаются явно; process.env не читается.
 *
 * @param {object} options
 * @param {import('langchain').BaseChatModel} options.model модель с поддержкой tool calling
 * @param {import('langchain').StructuredTool[]} options.tools
 * @param {string} [options.systemPrompt]
 * @param {typeof createAgent} [options.createAgentImpl] для тестов
 */
export function createTaskAgent({ model, tools, systemPrompt = SYSTEM_PROMPT, createAgentImpl = createAgent }) {
  if (!model) {
    throw new Error('createTaskAgent: не передана model');
  }
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('createTaskAgent: не переданы tools');
  }
  return createAgentImpl({
    name: 'task_agent',
    model,
    tools,
    systemPrompt,
    // toolStrategy: итог возвращается вызовом инструмента task_agent_response; при ответе,
    // не прошедшем JSON Schema, LangChain возвращает модели ошибку и просит повторить.
    // Модель видит упрощённую схему (шаги multiple без data) — см. modelResponseSchema.
    responseFormat: toolStrategy(modelResponseSchema),
  });
}

/** Понятное сообщение для пользователя по ошибке запуска агента — без stack trace и деталей. */
function describeAgentError(error) {
  const ollamaError = toOllamaError(error);
  if (ollamaError) {
    return ollamaError.message;
  }
  if (error?.name === 'GraphRecursionError') {
    return 'Агент не смог завершить запрос за допустимое число шагов.';
  }
  return 'Не удалось выполнить запрос агентом из-за внутренней ошибки.';
}

/** Результаты вызовов task tools из истории сообщений агента. */
function collectToolResults(messages = []) {
  return messages
    .filter((message) => ToolMessage.isInstance(message) && TOOL_ACTIONS.includes(message.name))
    .map((message) => {
      try {
        return { name: message.name, result: JSON.parse(message.content) };
      } catch {
        // Например, ошибка схемы входа tool — текст, а не JSON-контракт.
        return { name: message.name, result: { status: 'error', data: null, errors: [String(message.content)] } };
      }
    });
}

// Предел длины текста модели, который попадает в errors при текстовом fallback.
export const MAX_FALLBACK_TEXT_LENGTH = 500;

/**
 * Видимый текст ответа модели: только текстовые блоки, без reasoning/thinking
 * (ChatOllama кладёт их в additional_kwargs.reasoning_content, которое здесь не читается)
 * и без встроенных тегов <think>…</think>. Пробелы схлопываются, длина ограничивается.
 */
export function visibleModelText(content, maxLength = MAX_FALLBACK_TEXT_LENGTH) {
  const raw =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.filter((block) => typeof block === 'string' || block?.type === 'text').map((block) => (typeof block === 'string' ? block : block.text ?? '')).join(' ')
        : '';
  const text = raw
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, ' ')
    .replace(/<\/?think>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/**
 * Нормализация ответа без structuredResponse. Если task tools не вызывались, а модель завершила
 * работу обычным текстом, этот текст оборачивается в контракт как error/none. Намерение здесь
 * не распознаётся — переносится только уже полученный ответ модели. Если tools вызывались,
 * текст не может подтвердить результат операции, и возвращается null (техническая ошибка).
 */
function textFallbackResult(messages = []) {
  const taskToolsCalled =
    collectToolResults(messages).length > 0 ||
    messages.some((message) => AIMessage.isInstance(message) && message.tool_calls?.some((call) => TOOL_ACTIONS.includes(call.name)));
  const last = messages.at(-1);
  if (taskToolsCalled || !AIMessage.isInstance(last) || last.tool_calls?.length > 0) {
    return null;
  }
  const text = visibleModelText(last.content);
  return text ? agentErrorResult([text]) : null;
}

/**
 * Сверяет итоговый ответ модели с фактическими результатами tools: успех допустим только
 * при успешном вызове соответствующего tool. data для одиночного действия и шаги multiple
 * (action, status, data, errors) берутся из результатов tools, а не из пересказа модели.
 */
function groundInToolResults(response, toolResults, logger) {
  if (response.status !== 'success' || response.action === 'none') {
    return response;
  }
  const lastSuccess = (action) =>
    toolResults.findLast(({ name, result }) => name === action && result?.status === 'success');

  if (response.action === 'multiple') {
    if (toolResults.length < 2) {
      return agentErrorResult(
        [`Агент сообщил об успехе нескольких действий, но фактически вызвал tools: ${toolResults.length}`],
        'multiple',
      );
    }
    const steps = toolResults.map(({ name, result }) => {
      const succeeded = result?.status === 'success';
      return { action: name, status: succeeded ? 'success' : 'error', data: succeeded ? (result.data ?? null) : null, errors: result?.errors ?? [] };
    });
    const failed = steps.filter((step) => step.status === 'error');
    if (failed.length > 0) {
      return agentErrorResult(
        [`Агент сообщил об успехе, но не все действия выполнены: ${failed.map((step) => `${step.action} — ${step.errors.join('; ') || 'ошибка'}`).join(', ')}`],
        'multiple',
      );
    }
    const claimed = response.data.steps.map((step) => step.action).join(', ');
    const actual = steps.map((step) => step.action).join(', ');
    if (claimed !== actual) {
      logger.warn?.(`[agent] шаги ответа модели (${claimed}) отличаются от фактических вызовов tools (${actual}); используются фактические`);
    }
    return { ...response, data: { steps } };
  }

  const confirmed = lastSuccess(response.action);
  if (!confirmed) {
    return agentErrorResult([`Агент сообщил об успехе без успешного вызова tool ${response.action}`], response.action);
  }
  if (JSON.stringify(confirmed.result.data) !== JSON.stringify(response.data)) {
    logger.warn?.(`[agent] data ответа модели отличается от результата tool ${response.action}; используется результат tool`);
  }
  return { ...response, data: confirmed.result.data };
}

/**
 * Выполняет один пользовательский запрос и возвращает объект контракта
 * { status, action, data, errors }. Ничего не печатает и не выбрасывает исключений.
 *
 * @param {object} options
 * @param {{ invoke: Function }} options.agent
 * @param {string} options.userInput
 * @param {{ error: Function, warn?: Function, debug?: Function }} [options.logger]
 */
export async function runTaskAgent({ agent, userInput, logger = console }) {
  if (typeof userInput !== 'string' || userInput.trim() === '') {
    return agentErrorResult(['Пустой запрос: опишите, что нужно сделать с задачами.']);
  }

  let state;
  try {
    state = await agent.invoke({
      messages: [{ role: 'user', content: renderUserPrompt(userInput) }],
    });
  } catch (error) {
    // Диагностика — в лог; пользователю — только понятное сообщение.
    logger.error(`[agent] Ошибка выполнения: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
    logger.debug?.(error);
    return agentErrorResult([describeAgentError(error)]);
  }

  if (state?.structuredResponse === undefined) {
    // С toolStrategy итог приходит только вызовом task_agent_response. Ollama не поддерживает
    // tool_choice, поэтому локальная модель может ответить обычным текстом вместо вызова tool.
    const fallback = textFallbackResult(state?.messages);
    if (fallback) {
      logger.warn?.(`[agent] Модель ответила текстом без ${RESPONSE_TOOL_NAME}; текст перенесён в errors (tools не вызывались)`);
      return fallback;
    }
    logger.error('[agent] Агент завершился без structuredResponse: модель не вызвала tool итогового ответа');
    return agentErrorResult([
      `Локальная модель не выполнила требуемый tool calling: вместо вызова ${RESPONSE_TOOL_NAME} она ответила текстом. Повторите запрос или выберите в OLLAMA_MODEL модель с более надёжной поддержкой tools.`,
    ]);
  }

  const onInvalid = (problems) => logger.warn?.(`[agent] structuredResponse отклонён схемой: ${problems.join('; ')}`);
  const response = finalizeAgentResponse(state.structuredResponse, { schema: modelResponseSchema, onInvalid });
  // Итог после подстановки фактических результатов tools ещё раз проверяется контрактом ответа.
  return finalizeAgentResponse(groundInToolResults(response, collectToolResults(state.messages), logger), { onInvalid });
}
