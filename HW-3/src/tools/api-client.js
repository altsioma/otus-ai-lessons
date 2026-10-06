import { z } from 'zod';

// Контракт ответа локального API (см. src/api/responses.js). Лишние поля допускаются и сохраняются.
const apiResponseSchema = z.looseObject({
  status: z.enum(['success', 'error']),
  action: z.string(),
  data: z.unknown(),
  errors: z.array(z.string()),
});

export function errorResult(action, errors) {
  return { status: 'error', action, data: null, errors: Array.isArray(errors) ? errors : [errors] };
}

function describeFetchError(error) {
  if (error?.name === 'TimeoutError') {
    return 'превышено время ожидания ответа';
  }
  // Сетевые ошибки undici приходят как TypeError('fetch failed') с причиной в error.cause.
  const cause = error?.cause;
  return cause?.code ?? cause?.message ?? error?.message ?? String(error);
}

/**
 * HTTP-клиент локального API задач. Всегда возвращает объект контракта
 * { status, action, data, errors } и никогда не выбрасывает исключения.
 *
 * @param {object} options
 * @param {string} options.baseUrl базовый URL API, например http://localhost:3000
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  if (!baseUrl) {
    throw new Error('createApiClient: не задан baseUrl');
  }
  const root = baseUrl.replace(/\/+$/, '');

  /**
   * @returns {Promise<{ method: string, url: string, httpStatus: number | null, result: object }>}
   */
  async function request({ action, method, path, body }) {
    const url = `${root}${path}`;
    const init = { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const reason = describeFetchError(error);
      return { method, url, httpStatus: null, result: errorResult(action, `Не удалось соединиться с API ${root}: ${reason}`) };
    }

    const httpStatus = response.status;
    let payload;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      return { method, url, httpStatus, result: errorResult(action, `API вернул ответ не в формате JSON (HTTP ${httpStatus})`) };
    }

    const parsed = apiResponseSchema.safeParse(payload);
    const consistent = parsed.success && (parsed.data.status === 'success') === response.ok;
    if (!consistent) {
      return {
        method,
        url,
        httpStatus,
        result: errorResult(action, `API вернул ответ неожиданной структуры (HTTP ${httpStatus})`),
      };
    }

    // Корректный ответ API возвращаем без изменений, со всеми его полями.
    return { method, url, httpStatus, result: payload };
  }

  return { baseUrl: root, request };
}
