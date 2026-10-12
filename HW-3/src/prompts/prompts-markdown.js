import { DEFAULT_OLLAMA_MODEL } from '../config.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { USER_PROMPT_TEMPLATE } from './user-prompt.js';

export const EXAMPLE_REQUESTS = Object.freeze([
  ['создай задачу Подготовить отчёт', 'create_task'],
  ['покажи задачу Подготовить отчёт', 'get_task'],
  ['переведи задачу Подготовить отчёт в статус done', 'update_task_status'],
  ['сколько задач в работе?', 'get_task_stats'],
  ['создай задачу Купить молоко и начни работу над ней', 'create_task → update_task_status (multiple)'],
  ['удали все задачи', 'без вызова tools, status: error (действие не поддерживается)'],
]);

// Четыре обратные кавычки — чтобы блок не сломался, если в prompt появятся ``` .
const fence = (text, lang = '') => `\`\`\`\`${lang}\n${text}\n\`\`\`\``;

/**
 * Markdown-версия используемых промптов. prompts.md генерируется этой функцией
 * (npm run prompts:md), тест проверяет, что файл не разошёлся с исходниками.
 */
export function renderPromptsMarkdown() {
  const examples = EXAMPLE_REQUESTS.map(([request, expected]) => `| ${request} | ${expected} |`).join('\n');

  return `<!-- Файл сгенерирован командой \`npm run prompts:md\` из src/prompts/*.js. Не редактируйте вручную. -->

# Использованные промпты

Агент использует два промпта: системный prompt и пользовательский шаблон.
Оба передаются в LangChain \`createAgent\` (\`src/agent/task-agent.js\`).

Промпты, которыми проект последовательно создавался и проверялся, сохранены отдельно:
[\`docs/development-prompts.md\`](docs/development-prompts.md). Таким образом, репозиторий
содержит как runtime-промпты LLM, так и полный журнал промптов разработки.

| Промпт | Исходный файл | Экспорт |
|---|---|---|
| Системный prompt | \`src/prompts/system-prompt.js\` | \`SYSTEM_PROMPT\` |
| Пользовательский шаблон | \`src/prompts/user-prompt.js\` | \`USER_PROMPT_TEMPLATE\`, \`renderUserPrompt()\` |

Промпты отправляются локальной модели через \`ChatOllama\` (\`@langchain/ollama\`): провайдер — локальный
Ollama (\`OLLAMA_BASE_URL\`), модель по умолчанию — \`${DEFAULT_OLLAMA_MODEL}\` (меняется через \`OLLAMA_MODEL\`),
\`temperature: 0\`. Токены и API key не нужны. Перед первым запуском: \`ollama serve\` и
\`ollama pull ${DEFAULT_OLLAMA_MODEL}\`. Обычные тесты (\`npm test\`) к модели не обращаются;
live evaluation (\`npm run eval:agent\`) отправляет эти промпты локальной модели.

## Системный prompt

Передаётся в \`createAgent({ systemPrompt })\`. Полный текст:

${fence(SYSTEM_PROMPT, 'text')}

## Пользовательский шаблон

${fence(USER_PROMPT_TEMPLATE, 'text')}

| Переменная | Значение |
|---|---|
| \`{{USER_REQUEST}}\` | Текст запроса из аргументов CLI (\`npm start -- "<запрос>"\`), все аргументы объединяются через пробел. Подставляется без изменения смысла: убираются только пробелы по краям. |

Результат подстановки передаётся агенту как сообщение пользователя:
\`{ messages: [{ role: "user", content: <USER_REQUEST> }] }\`. Дополнительных инструкций
шаблон не содержит — все правила находятся в системном prompt.

## Примеры запросов

| Запрос | Ожидаемый вызов |
|---|---|
${examples}
`;
}
