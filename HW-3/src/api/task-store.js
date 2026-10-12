import { randomUUID } from 'node:crypto';

export const TASK_STATUSES = Object.freeze(['pending', 'in_progress', 'done']);

/**
 * Создаёт изолированное хранилище задач в памяти.
 * Каждый вызов возвращает новый экземпляр со своим состоянием.
 */
export function createTaskStore({ now = () => new Date() } = {}) {
  const tasks = new Map();

  // Наружу отдаём копии, чтобы вызывающий код не мог изменить состояние хранилища.
  const snapshot = (task) => (task ? { ...task } : null);

  return {
    create({ title }) {
      const timestamp = now().toISOString();
      const task = {
        id: randomUUID(),
        title,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tasks.set(task.id, task);
      return snapshot(task);
    },

    get(id) {
      return snapshot(tasks.get(id));
    },

    updateStatus(id, status) {
      const task = tasks.get(id);
      if (!task) {
        return null;
      }
      task.status = status;
      task.updatedAt = now().toISOString();
      return snapshot(task);
    },

    stats() {
      const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
      for (const task of tasks.values()) {
        byStatus[task.status] += 1;
      }
      return { total: tasks.size, byStatus };
    },
  };
}
