/**
 * Единый контракт ответов API:
 * { status: 'success' | 'error', action, data, errors: string[] }
 */

export class ApiError extends Error {
  constructor(httpStatus, errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join('; '));
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.errors = list;
  }
}

export function sendSuccess(res, httpStatus, data) {
  res.status(httpStatus).json({
    status: 'success',
    action: res.locals.action ?? 'unknown',
    data,
    errors: [],
  });
}

export function sendError(res, httpStatus, errors) {
  res.status(httpStatus).json({
    status: 'error',
    action: res.locals.action ?? 'unknown',
    data: null,
    errors,
  });
}
