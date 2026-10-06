// Демонстрация LangChain tools без LLM и без Ollama:
// поднимает локальный API на случайном порту и вызывает tools через invoke().
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/api/app.js';
import { createTaskTools } from '../src/tools/task-tools.js';

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve(server)));
  });
}

const server = await listen(createApp());
try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`Локальный API запущен: ${baseUrl}\n`);

  const tools = Object.fromEntries(createTaskTools({ baseUrl }).map((t) => [t.name, t]));

  async function step(title, toolName, input) {
    console.log(`=== ${title}: ${toolName}.invoke(${JSON.stringify(input)})`);
    const result = JSON.parse(await tools[toolName].invoke(input));
    console.log('');
    return result;
  }

  const created = await step('1. Создание задачи', 'create_task', { title: 'Подготовить отчёт' });
  const { id } = created.data;
  await step('2. Получение задачи', 'get_task', { id });
  await step('3. Изменение статуса', 'update_task_status', { id, status: 'in_progress' });
  await step('4. Статистика', 'get_task_stats', {});
  await step('5. Ошибка: несуществующая задача', 'get_task', { id: randomUUID() });
} finally {
  await new Promise((resolve) => server.close(resolve));
  console.log('Локальный API остановлен.');
}
