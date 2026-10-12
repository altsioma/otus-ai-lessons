# Минимальный агент на LangChain.js

Учебный проект (ДЗ-3, спецификация — [task.md](task.md)): AI-агент на LangChain.js,
который принимает запросы на естественном языке и выполняет операции
над локальным HTTP API управления задачами.

Отчёт для сдачи — [report.md](report.md), промпты агента — [prompts.md](prompts.md).

## Архитектура

```
запрос в CLI ──► LangChain agent (createAgent + ChatOllama) ──► LangChain tool ──► fetch ──► HTTP API (Express)
   main.js         src/agent/task-agent.js                     src/tools/*          │       src/api/*
                          │                                                         ▼
                          └──► локальный Ollama (OLLAMA_BASE_URL, модель OLLAMA_MODEL)
stdout: JSON-контракт ◄── проверка схемой и сверка с результатами tools ◄── JSON-ответ API
```

1. `main.js` → `src/cli.js` собирает аргументы в один запрос и создаёт агента.
2. Агент (`createAgent` из `langchain`, модель `ChatOllama` — локальный Ollama) по системному prompt
   выбирает tool и вызывает его (при необходимости несколько раз последовательно).
3. Tool выполняет реальный HTTP-запрос к API, запущенному командой `npm run api`.
4. Итог модель возвращает через structured output (`toolStrategy`, инструмент
   `task_agent_response`); `runTaskAgent` проверяет его zod-схемой и сверяет
   с фактическими результатами tools.

## Стек

- Node.js, JavaScript (ES Modules)
- LangChain.js + `@langchain/ollama` (LLM-провайдер — локальный [Ollama](https://ollama.com), модель по умолчанию `qwen3:8b`)
- Express 5 — локальный API задач
- `dotenv` + `zod` — загрузка и валидация конфигурации
- Vitest — тесты

## Требования

- Node.js **20.19+** или **22.12+** (нижняя граница определяется Vitest/Vite)
- npm
- [Ollama](https://ollama.com) с моделью, поддерживающей tool calling (по умолчанию `qwen3:8b`) —
  только для запуска агента и `npm run eval:agent`; тесты, API и `demo:tools` работают без него.

Токены, API key и регистрация во внешних сервисах **не нужны**: модель работает локально.

## Установка

```bash
npm install          # или npm ci — точная установка по package-lock.json
cp .env.example .env # необязательно: значения по умолчанию подходят для локального Ollama

ollama serve         # локальный сервер Ollama (если не запущен как приложение/служба)
ollama pull qwen3:8b # модель по умолчанию, скачивается один раз (~5 ГБ)
```

Проект **не скачивает модель автоматически**. Если установлена только `qwen3:4b`
(или другая модель с поддержкой tools), выберите её через переменную окружения:

```bash
OLLAMA_MODEL=qwen3:4b npm start -- "покажи статистику задач"
# или строкой OLLAMA_MODEL=qwen3:4b в .env
```

Модель вызывается через `ChatOllama` с `temperature: 0`, `think: false` (режим рассуждений
qwen3 отключён: для выбора tool он не нужен и многократно замедляет ответ) и `numCtx: 8192`
(system prompt и схемы tools не помещаются надёжно в типичный контекст Ollama 4096 токенов).

## Конфигурация (.env)

| Переменная          | Обязательна | По умолчанию                   | Назначение                                   |
|---------------------|-------------|--------------------------------|----------------------------------------------|
| `OLLAMA_BASE_URL`   | нет         | `http://127.0.0.1:11434`       | Адрес локального сервера Ollama              |
| `OLLAMA_MODEL`      | нет         | `qwen3:8b`                     | Модель Ollama с поддержкой tool calling      |
| `OLLAMA_TIMEOUT_MS` | нет         | `120000`                       | Таймаут одного запроса к модели, мс          |
| `API_PORT`          | нет         | `3000`                         | Порт локального API                          |
| `API_BASE_URL`      | нет         | `http://localhost:${API_PORT}` | Адрес API для LangChain tool                 |

Обязательных переменных нет, токенов и ключей нет. Конфигурация загружается и валидируется
в `src/config.js` (`loadConfig()`); импорт модулей проекта не делает сетевых запросов.

## Команды

```bash
npm test             # все тесты (Vitest); Ollama и сеть не нужны, к модели не обращаются
npm run api          # локальный HTTP API задач
npm start -- "..."   # CLI-агент (то же: npm run agent -- "...")
npm run demo:tools   # демонстрация LangChain tools без LLM и без Ollama
npm run eval:agent   # live-проверка агента: 5 запросов к локальной модели Ollama
npm run prompts:md   # пересобрать prompts.md из src/prompts/*.js
npm run check        # проверка синтаксиса всех JS-файлов проекта
```

## Запуск агента

Агенту нужны запущенные Ollama (`ollama serve`, модель из `OLLAMA_MODEL` установлена) и API. Состояние задач живёт **только в процессе `npm run api`**:
пока он работает, задачи сохраняются между запросами CLI; после его остановки они пропадают.

**Терминал 1** — API:

```bash
npm run api
```

**Терминал 2** — запросы на естественном языке:

```bash
# создать задачу → create_task
npm start -- "создай задачу Подготовить отчёт"

# получить задачу по UUID → get_task (UUID возьмите из data.id предыдущего ответа)
npm start -- "покажи задачу Подготовить отчёт"

# изменить статус → update_task_status
npm run agent -- "переведи задачу Подготовить отчёт в статус done"

# статистика → get_task_stats
npm run agent -- "покажи статистику задач"

# несколько действий → create_task, затем update_task_status (action: multiple)
npm start -- "создай задачу Купить молоко и начни работу над ней"

# неподдерживаемый запрос → status: error без вызова tools
npm start -- "удали все задачи"
```

Каждый запуск CLI — отдельный разговор: агент не помнит предыдущие запросы. ID задачи,
полученный в одном запуске, передавайте явно в следующих запросах.

В stdout печатается только финальный JSON; отладочные логи tools (`[tool:...] METHOD URL`)
и диагностика идут в stderr, поэтому результат можно перенаправить: `npm start --silent -- "..." > result.json`.

### Контракт ответа агента

```json
{
  "status": "success | error",
  "action": "create_task | get_task | update_task_status | get_task_stats | multiple | none",
  "data": "<объект или null>",
  "errors": ["сообщения об ошибках"]
}
```

| Поле | Правило |
|---|---|
| `status` | `success` — всё выполнено; `error` — хотя бы одно действие не выполнено или запрос не поддерживается |
| `action` | одно из четырёх действий; `multiple` — несколько вызовов tools; `none` — tools не вызывались |
| `data` | задача (`create_task`, `get_task`, `update_task_status`); статистика (`get_task_stats`); `{"steps": [...]}` для `multiple`; `{"message": "..."}` для ответа без tools; **всегда `null` при `error`** |
| `errors` | **пустой при `success`**; при `error` — минимум одно понятное сообщение |

Пример (`npm start -- "создай задачу Подготовить отчёт"`):

```json
{
  "status": "success",
  "action": "create_task",
  "data": {
    "id": "6f1c1c9e-2d7c-4b8e-9a51-6a0e2f3b1d42",
    "title": "Подготовить отчёт",
    "status": "pending",
    "createdAt": "2026-10-06T18:00:00.000Z",
    "updatedAt": "2026-10-06T18:00:00.000Z"
  },
  "errors": []
}
```

Схема: `src/agent/response-schema.js` (`agentResponseSchema` — итоговый контракт, `finalizeAgentResponse`).
Модели передаётся упрощённая схема инструмента `task_agent_response` (`modelResponseSchema`): она совпадает
с контрактом, кроме `multiple`. Для `multiple` модель перечисляет только шаги `{"action", "status"}`, а `data` и
`errors` каждого шага `runTaskAgent` подставляет из фактических результатов tools в порядке вызова. Так
модель не переписывает объекты задач, а глубоко вложенный JSON, который 8B-модель генерировала с
потерянными скобками, ей больше не нужен. Итог печатается в полном формате контракта.
Требования к формату для модели — в системном prompt (`src/prompts/system-prompt.js`, см. [prompts.md](prompts.md)).

Перед выводом `runTaskAgent` дополнительно:

- проверяет ответ zod-схемой (включая правила согласованности полей);
- не принимает `success`, если соответствующий tool фактически не вернул `success`;
- для одиночного действия берёт `data` из фактического результата tool, а не из пересказа модели;
- для `multiple` собирает шаги из фактических вызовов tools и не принимает `success`, если какой-то шаг завершился ошибкой.

### Коды завершения CLI

| Код | Когда |
|---|---|
| 0 | `status: success` |
| 1 | `status: error` (ошибка API, неподдерживаемый запрос, ошибка Ollama) |
| 2 | запрос не передан — печатается инструкция |
| 3 | ошибка конфигурации или инициализации (например, некорректный `OLLAMA_BASE_URL`) |

Stack trace пользователю не выводится; для диагностики запустите с `AGENT_DEBUG=1`.

### Ошибки Ollama

Ошибки локальной модели превращаются в понятные сообщения в `errors` (`src/agent/ollama.js`, `toOllamaError()`):

| Ситуация | Сообщение (сокращённо) |
|---|---|
| Ollama не запущен / недоступен по `OLLAMA_BASE_URL` | «Ollama не запущен или недоступен… Запустите сервер командой: ollama serve» |
| модель не установлена | «Модель qwen3:8b не найдена в Ollama. Установите её командой: ollama pull qwen3:8b» |
| превышено время ожидания (`OLLAMA_TIMEOUT_MS`) | «Превышено время ожидания ответа Ollama…» |
| модель не поддерживает tools | «Модель … не поддерживает tool calling в Ollama…» |
| модель вызвала task tools, но завершила текстом вместо `task_agent_response` | «Локальная модель не выполнила требуемый tool calling…» |

Последние случаи специфичны для локальных моделей: `toolStrategy` просит модель вызвать tool
(`tool_choice: "any"`), но Ollama этот параметр не поддерживает, и небольшая модель может ответить
обычным текстом. Тогда `runTaskAgent` нормализует формат, не распознавая намерение:

- **task tools не вызывались** и последняя `AIMessage` содержит видимый текст — этот текст становится
  ответом `{"status": "error", "action": "none", "data": null, "errors": ["<текст модели>"]}`.
  Берутся только текстовые блоки: reasoning/thinking и теги `<think>…</think>` отбрасываются, длина
  ограничена 500 символами;
- **task tools вызывались** — текст не может подтвердить результат операции, возвращается техническая
  ошибка выше.

### Ограничения агента

- поиск задачи по названию не поддерживается;
- список задач не поддерживается (в API нет такой операции);
- для чтения и изменения задачи нужен её UUID;
- удаление задач, изменение названия, исполнители, сроки и приоритеты не поддерживаются;
- агент не хранит историю между запусками CLI.

## Проверка агента (live evaluation)

```bash
npm run eval:agent
```

Команда выполняет **пять запросов к локальной модели Ollama** через `ChatOllama` (создание задачи,
её получение по ID, отметка как выполненной, статистика, неподдерживаемое удаление).
Токены и API key не нужны.

- Сначала выполняется preflight (`checkOllama()` в `src/agent/ollama.js`): `GET /api/version` и
  `GET /api/tags` по `OLLAMA_BASE_URL`. Если Ollama недоступен, модель `OLLAMA_MODEL` не установлена
  или не поддерживает tools, команда завершается с кодом 3, **не запуская ни API, ни сценарии**,
  и печатает причину — например, точную команду `ollama pull qwen3:8b`. Модель не скачивается автоматически.

- Временный API запускается автоматически на случайном loopback-порту и останавливается после
  проверки — отдельный `npm run api` не нужен.
- ID для запросов 2 и 3 берётся из фактического ответа на запрос 1.
- Каждый сценарий проверяется по action, данным и trace `[tool:...]` (HTTP-метод и путь).
- Результат — `docs/evaluation-results.md`; код завершения ненулевой, если хоть один сценарий FAIL.
- Формат отчёта: [docs/evaluation-results.example.md](docs/evaluation-results.example.md)
  (демонстрационный пример, не результат).

Обычный `npm test` к модели не обращается и запущенный Ollama не требует: агент в тестах работает
с заглушками и `FakeToolCallingModel`, `ChatOllama` — с подменённым `fetch` (эмуляция `/api/chat`),
preflight — с мокированным `fetch`.

## Локальный API задач

```bash
npm run api
# Tasks API запущен: http://localhost:3000 (данные хранятся в памяти)
```

Базовый URL: `http://localhost:${API_PORT}` (по умолчанию `http://localhost:3000`).
Остановка — `Ctrl+C`.

> **Данные хранятся только в памяти процесса.** После перезапуска сервера все задачи
> пропадают; база данных не используется.

### Endpoint

| Метод   | Путь                 | action               | Назначение                          | Успех |
|---------|----------------------|----------------------|-------------------------------------|-------|
| `POST`  | `/tasks`             | `create_task`        | Создать задачу (`{"title": "..."}`) | 201   |
| `GET`   | `/tasks/:id`         | `get_task`           | Получить задачу по ID               | 200   |
| `PATCH` | `/tasks/:id/status`  | `update_task_status` | Изменить статус (`{"status": "..."}`) | 200 |
| `GET`   | `/tasks/stats`       | `get_task_stats`     | Общее число задач и число по статусам | 200 |
| `GET`   | `/health`            | `health_check`       | Проверка, что сервис работает (служебный) | 200 |

Правила валидации:

- `title` — строка, после `trim` от 1 до 200 символов;
- `status` — `pending`, `in_progress` или `done`; новая задача создаётся в статусе `pending`;
- `id` — UUID (генерируется через `crypto.randomUUID()`);
- лишние поля в теле запроса и некорректный JSON отклоняются с кодом 400.

### Примеры curl

```bash
# Создать задачу
curl -s -X POST http://localhost:3000/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title": "Подготовить отчёт"}'

# Получить задачу (подставьте id из ответа на создание)
curl -s http://localhost:3000/tasks/<id>

# Изменить статус
curl -s -X PATCH http://localhost:3000/tasks/<id>/status \
  -H 'Content-Type: application/json' \
  -d '{"status": "in_progress"}'

# Статистика
curl -s http://localhost:3000/tasks/stats
```

### Формат ответа

Все ответы, включая ошибки и неизвестные маршруты, имеют одну структуру.

Успех (`POST /tasks`, 201):

```json
{
  "status": "success",
  "action": "create_task",
  "data": {
    "id": "6f1c1c9e-2d7c-4b8e-9a51-6a0e2f3b1d42",
    "title": "Подготовить отчёт",
    "status": "pending",
    "createdAt": "2026-10-06T18:00:00.000Z",
    "updatedAt": "2026-10-06T18:00:00.000Z"
  },
  "errors": []
}
```

Статистика (`GET /tasks/stats`, 200):

```json
{
  "status": "success",
  "action": "get_task_stats",
  "data": { "total": 3, "byStatus": { "pending": 1, "in_progress": 1, "done": 1 } },
  "errors": []
}
```

Ошибка (`PATCH /tasks/:id/status` с `{"status": "archived"}`, 400):

```json
{
  "status": "error",
  "action": "update_task_status",
  "data": null,
  "errors": ["status должен быть одним из: pending, in_progress, done"]
}
```

| Код | Когда |
|-----|-------|
| 400 | Невалидное тело, некорректный JSON, лишние поля, `id` не UUID |
| 404 | Задача не найдена или неизвестный маршрут (`action: "unknown"`) |
| 500 | Неожиданная ошибка сервера: клиенту возвращается `"Внутренняя ошибка сервера"` без stack trace, подробности пишутся в лог сервера |

## LangChain tools

Четыре tool создаются фабрикой `createTaskTools({ baseUrl, fetchImpl, logger, timeoutMs })`
штатной функцией `tool` из `langchain`. Входы описаны zod-схемами. Каждый tool выполняет
реальный HTTP-запрос к локальному API через `fetch` и не обращается к хранилищу напрямую.

| Tool                 | Вход                          | HTTP-вызов                 |
|----------------------|-------------------------------|----------------------------|
| `create_task`        | `{ title }`                   | `POST /tasks`              |
| `get_task`           | `{ id }` (UUID)               | `GET /tasks/:id`           |
| `update_task_status` | `{ id, status }`              | `PATCH /tasks/:id/status`  |
| `get_task_stats`     | `{}`                          | `GET /tasks/stats`         |

`baseUrl` передаётся явно (в приложении — из `config.api.baseUrl`, то есть `API_BASE_URL`);
tools не читают `process.env`.

**Результат.** Tool возвращает JSON-строку контракта
`{ "status": "success" | "error", "action", "data", "errors" }`.
Корректный ответ API возвращается как есть, без потери полей. Ошибки не выбрасываются,
а возвращаются как `status: "error"`, `data: null` и понятный текст в `errors`:

| Ситуация                           | `errors`                                                    |
|------------------------------------|-------------------------------------------------------------|
| API вернул 400 / 404 / 500         | сообщения из ответа API                                     |
| API недоступен                     | `Не удалось соединиться с API <url>: ECONNREFUSED`          |
| Ответ не JSON                      | `API вернул ответ не в формате JSON (HTTP <код>)`           |
| JSON другой структуры              | `API вернул ответ неожиданной структуры (HTTP <код>)`       |

Невалидный вход (пустой `title`, `id` не UUID, неизвестный `status`) отклоняется схемой
LangChain tool ещё до HTTP-запроса (`ToolInputParsingException`).

**Где это в коде:**

- tools объявлены в `src/tools/task-tools.js` (фабрика `createTaskTools`);
- HTTP-запрос через `fetch` выполняется в `src/tools/api-client.js` (функция `request`);
- результат каждого tool выводится в лог функцией `logToolResult` в `src/tools/task-tools.js`.

Формат отладочного лога (секреты и заголовки не логируются):

```
[tool:create_task] POST http://127.0.0.1:51659/tasks -> HTTP 201
  input:  {"title":"Подготовить отчёт"}
  result: {"status":"success","action":"create_task","data":{...},"errors":[]}
```

### Демонстрация

```bash
npm run demo:tools
```

Скрипт `scripts/demo-tools.js` поднимает API на случайном свободном порту, через `invoke()`
создаёт задачу, получает её, меняет статус, запрашивает статистику и показывает ошибку 404,
после чего останавливает сервер. LLM и Ollama не нужны.

## Структура

```
main.js                           — точка входа CLI
src/cli.js                        — CLI: разбор аргументов, вывод JSON, коды завершения
src/config.js                     — загрузка и валидация конфигурации
src/agent/task-agent.js           — createTaskAgent() (createAgent) и runTaskAgent()
src/agent/configured-agent.js     — createConfiguredTaskAgent(): ChatOllama + HTTP tools
src/agent/ollama.js               — preflight Ollama, таймаут запросов, понятные ошибки
src/agent/response-schema.js      — zod-контракт ответа агента
src/prompts/system-prompt.js      — системный prompt
src/prompts/user-prompt.js        — пользовательский шаблон {{USER_REQUEST}}
src/prompts/prompts-markdown.js   — генерация prompts.md
src/evaluation/run-evaluation.js  — runEvaluation(): пять сценариев live-проверки
src/evaluation/render-report.js   — Markdown-отчёт проверки
src/tools/task-tools.js           — createTaskTools(): четыре LangChain tool и их логирование
src/tools/api-client.js           — HTTP-клиент API на fetch с обработкой ошибок
src/api/app.js                    — createApp(): Express-приложение без открытия порта
src/api/server.js                 — запуск HTTP-сервера (npm run api)
src/api/task-store.js             — createTaskStore(): изолированное хранилище задач в памяти
src/api/validation.js             — zod-схемы и форматирование ошибок валидации
src/api/responses.js              — единый формат ответов и ApiError
scripts/                          — проверка синтаксиса, demo:tools, eval:agent, генерация prompts.md
tests/                            — тесты Vitest
prompts.md                        — использованные промпты (генерируется)
report.md                         — отчёт для сдачи
docs/development-prompts.md       — промпты, которыми разрабатывался проект
docs/evaluation-results*.md       — результаты live-проверки / пример формата
```
