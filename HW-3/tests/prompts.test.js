import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RESPONSE_TOOL_NAME } from '../src/agent/response-schema.js';
import { renderPromptsMarkdown } from '../src/prompts/prompts-markdown.js';
import { SYSTEM_PROMPT } from '../src/prompts/system-prompt.js';
import { renderUserPrompt, USER_PROMPT_TEMPLATE } from '../src/prompts/user-prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('называет все четыре tool и инструмент итогового ответа', () => {
    for (const name of ['create_task', 'get_task', 'update_task_status', 'get_task_stats', RESPONSE_TOOL_NAME]) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it.each([
    ['роль', 'оператор локального API задач'],
    ['обязательный вызов tools', 'только через соответствующий tool'],
    ['запрет выдумывать', 'Не придумывай задачи, ID, статусы'],
    ['успех только после success', 'пока tool не вернул "status": "success"'],
    ['ошибка tool сохраняется', 'Итоговый ответ тоже должен иметь status error'],
    ['последовательные вызовы', '«создай задачу X и начни работу над ней» — create_task, затем update_task_status с id из результата create_task'],
    ['без лишних шагов', '«создай задачу X» — это только create_task, без изменения статуса'],
    ['шаги multiple без данных', 'только поля action и status; данные задач не повторяй'],
    ['нужен UUID', 'Если UUID нет, не вызывай tool и верни ошибку'],
    ['нет поиска по названию', 'не умеешь искать задачу по названию'],
    ['вопрос о возможностях без tools', 'На вопрос о твоих возможностях отвечай без вызова tools'],
    ['неподдерживаемые действия', 'Неподдерживаемое действие не выполняй и не имитируй'],
    ['язык', 'кратко и на русском языке'],
    ['пример неподдерживаемого удаления', '{"status": "error", "action": "none", "data": null, "errors": ["Удаление задач не поддерживается"]}'],
    ['контракт', 'action: create_task, get_task, update_task_status или get_task_stats'],
  ])('содержит ограничение: %s', (_, fragment) => {
    expect(SYSTEM_PROMPT).toContain(fragment);
  });
});

describe('пользовательский шаблон', () => {
  it('передаёт запрос без изменения смысла', () => {
    expect(USER_PROMPT_TEMPLATE).toBe('{{USER_REQUEST}}');
    expect(renderUserPrompt('  создай задачу $1 & {{x}}  ')).toBe('создай задачу $1 & {{x}}');
  });
});

describe('prompts.md', () => {
  it('совпадает с исходниками промптов (npm run prompts:md)', () => {
    const file = readFileSync(new URL('../prompts.md', import.meta.url), 'utf8');

    expect(file).toBe(renderPromptsMarkdown());
    expect(file).toContain(SYSTEM_PROMPT);
    expect(file).toContain('{{USER_REQUEST}}');
  });
});
