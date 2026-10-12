// Пользовательский шаблон: запрос передаётся модели как есть, без дополнительных инструкций —
// все правила находятся в системном prompt.
export const USER_PROMPT_TEMPLATE = '{{USER_REQUEST}}';

/**
 * Подставляет запрос пользователя в шаблон. Убираются только пробелы по краям.
 *
 * @param {string} userRequest
 * @returns {string}
 */
export function renderUserPrompt(userRequest) {
  // Функция-заменитель, чтобы символы `$` в запросе не трактовались как шаблоны замены.
  return USER_PROMPT_TEMPLATE.replace('{{USER_REQUEST}}', () => userRequest.trim());
}
