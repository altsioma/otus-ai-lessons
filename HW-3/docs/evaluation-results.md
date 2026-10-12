# Результаты проверки агента

Отчёт сгенерирован командой `npm run eval:agent` по фактическому запуску с локальной моделью Ollama (`ChatOllama`). Токены и API key не использовались.

| Параметр | Значение |
|---|---|
| Начало запуска (UTC) | 2026-10-06T19:09:13.874Z |
| Окончание запуска (UTC) | 2026-10-06T19:09:50.639Z |
| Модель (`OLLAMA_MODEL`) | `qwen3:8b` |
| Ollama | `http://127.0.0.1:11434`, версия 0.34.3 |
| Node.js | v22.23.0 |
| Пакеты | `langchain` 1.5.15, `@langchain/ollama` 1.3.0 |
| API | временный локальный Express API (`createApp()`) на `http://127.0.0.1:64386` с новым in-memory хранилищем; запущен runner'ом на время проверки и остановлен после неё |
| Итог | **5 из 5 сценариев PASS** |

## Сводка

| # | Запрос | Ожидаемое действие | Фактическое действие | Ожидаемый HTTP-вызов | Фактический вызов | Результат |
|---|---|---|---|---|---|---|
| 1 | создай задачу Подготовить итоговый отчёт | create_task (success) | create_task (success) | POST /tasks | POST /tasks → 201 | **PASS** |
| 2 | покажи задачу 47fe43d3-2681-406b-85fe-aa35b3e346c4 | get_task (success) | get_task (success) | GET /tasks/:id | GET /tasks/47fe43d3-2681-406b-85fe-aa35b3e346c4 → 200 | **PASS** |
| 3 | отметь задачу 47fe43d3-2681-406b-85fe-aa35b3e346c4 как выполненную | update_task_status (success) | update_task_status (success) | PATCH /tasks/:id/status | PATCH /tasks/47fe43d3-2681-406b-85fe-aa35b3e346c4/status → 200 | **PASS** |
| 4 | покажи статистику задач | get_task_stats (success) | get_task_stats (success) | GET /tasks/stats | GET /tasks/stats → 200 | **PASS** |
| 5 | удали все задачи | none (error) | none (error) | без вызова tools | нет вызовов | **PASS** |

ID задачи для сценариев 2 и 3 взят из фактического `data.id` ответа сценария 1.

## Подробности

### 1. Создание задачи — PASS

Запрос: `создай задачу Подготовить итоговый отчёт`

Ответ агента:

```json
{
  "status": "success",
  "action": "create_task",
  "data": {
    "id": "47fe43d3-2681-406b-85fe-aa35b3e346c4",
    "title": "Подготовить итоговый отчёт",
    "status": "pending",
    "createdAt": "2026-10-06T19:09:15.321Z",
    "updatedAt": "2026-10-06T19:09:15.321Z"
  },
  "errors": []
}
```

Trace tools:

```text
[tool:create_task] POST http://127.0.0.1:64386/tasks -> HTTP 201
  input:  {"title":"Подготовить итоговый отчёт"}
  result: {"status":"success","action":"create_task","data":{"id":"47fe43d3-2681-406b-85fe-aa35b3e346c4","title":"Подготовить итоговый отчёт","status":"pending","createdAt":"2026-10-06T19:09:15.321Z","updatedAt":"2026-10-06T19:09:15.321Z"},"errors":[]}
```

### 2. Получение созданной задачи — PASS

Запрос: `покажи задачу 47fe43d3-2681-406b-85fe-aa35b3e346c4`

Ответ агента:

```json
{
  "status": "success",
  "action": "get_task",
  "data": {
    "id": "47fe43d3-2681-406b-85fe-aa35b3e346c4",
    "title": "Подготовить итоговый отчёт",
    "status": "pending",
    "createdAt": "2026-10-06T19:09:15.321Z",
    "updatedAt": "2026-10-06T19:09:15.321Z"
  },
  "errors": []
}
```

Trace tools:

```text
[tool:get_task] GET http://127.0.0.1:64386/tasks/47fe43d3-2681-406b-85fe-aa35b3e346c4 -> HTTP 200
  input:  {"id":"47fe43d3-2681-406b-85fe-aa35b3e346c4"}
  result: {"status":"success","action":"get_task","data":{"id":"47fe43d3-2681-406b-85fe-aa35b3e346c4","title":"Подготовить итоговый отчёт","status":"pending","createdAt":"2026-10-06T19:09:15.321Z","updatedAt":"2026-10-06T19:09:15.321Z"},"errors":[]}
```

### 3. Изменение статуса — PASS

Запрос: `отметь задачу 47fe43d3-2681-406b-85fe-aa35b3e346c4 как выполненную`

Ответ агента:

```json
{
  "status": "success",
  "action": "update_task_status",
  "data": {
    "id": "47fe43d3-2681-406b-85fe-aa35b3e346c4",
    "title": "Подготовить итоговый отчёт",
    "status": "done",
    "createdAt": "2026-10-06T19:09:15.321Z",
    "updatedAt": "2026-10-06T19:09:35.636Z"
  },
  "errors": []
}
```

Trace tools:

```text
[tool:update_task_status] PATCH http://127.0.0.1:64386/tasks/47fe43d3-2681-406b-85fe-aa35b3e346c4/status -> HTTP 200
  input:  {"id":"47fe43d3-2681-406b-85fe-aa35b3e346c4","status":"done"}
  result: {"status":"success","action":"update_task_status","data":{"id":"47fe43d3-2681-406b-85fe-aa35b3e346c4","title":"Подготовить итоговый отчёт","status":"done","createdAt":"2026-10-06T19:09:15.321Z","updatedAt":"2026-10-06T19:09:35.636Z"},"errors":[]}
```

### 4. Статистика — PASS

Запрос: `покажи статистику задач`

Ответ агента:

```json
{
  "status": "success",
  "action": "get_task_stats",
  "data": {
    "total": 1,
    "byStatus": {
      "pending": 0,
      "in_progress": 0,
      "done": 1
    }
  },
  "errors": []
}
```

Trace tools:

```text
[tool:get_task_stats] GET http://127.0.0.1:64386/tasks/stats -> HTTP 200
  input:  {}
  result: {"status":"success","action":"get_task_stats","data":{"total":1,"byStatus":{"pending":0,"in_progress":0,"done":1}},"errors":[]}
```

### 5. Неподдерживаемое действие — PASS

Запрос: `удали все задачи`

Ответ агента:

```json
{
  "status": "error",
  "action": "none",
  "data": null,
  "errors": [
    "Удаление задач не поддерживается"
  ]
}
```

Trace tools: **ни один task tool не вызван** (строк `[tool:...]` нет).
