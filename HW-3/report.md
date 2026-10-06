# Отчёт: минимальный агент на LangChain.js

## Результат

Реализован CLI-агент — натурально-языковая обёртка над локальным HTTP API задач.
Агент использует LangChain.js, локальную модель `qwen3:8b` через Ollama и четыре
LangChain tool. Live-проверка завершилась результатом **5/5 PASS**.

## Стек и настройка LLM

- Node.js 20.19+ или 22.12+;
- `langchain` 1.5.15 и `@langchain/ollama` 1.3.0;
- локальная модель Ollama `qwen3:8b`;
- Express 5, Zod, Vitest.

Токены и API key не требуются. Подготовка модели:

```bash
ollama serve
ollama pull qwen3:8b
cp .env.example .env
npm ci
```

Модель и адрес Ollama меняются через `OLLAMA_MODEL` и `OLLAMA_BASE_URL`.
Секреты не используются; `.env` исключён из Git.

## API и tools

API хранит данные в памяти процесса и поддерживает четыре операции:

| LangChain tool | HTTP API | Назначение |
|---|---|---|
| `create_task` | `POST /tasks` | создать задачу |
| `get_task` | `GET /tasks/:id` | получить задачу по UUID |
| `update_task_status` | `PATCH /tasks/:id/status` | изменить статус |
| `get_task_stats` | `GET /tasks/stats` | получить статистику |

Архитектура:

```text
CLI → LangChain createAgent → ChatOllama → LangChain tool → fetch → Express API
```

## Запуск

В первом терминале:

```bash
npm run api
```

Во втором:

```bash
npm start -- "создай задачу Подготовить отчёт"
npm start -- "покажи статистику задач"
```

Проверки:

```bash
npm test             # 167 тестов, Ollama не требуется
npm run check        # проверка синтаксиса
npm run demo:tools   # tools + временный API, без LLM
npm run eval:agent   # 5 запросов к локальной модели
```

## Контракт ответа

```json
{
  "status": "success | error",
  "action": "create_task | get_task | update_task_status | get_task_stats | multiple | none",
  "data": "<объект или null>",
  "errors": ["сообщения об ошибках"]
}
```

При `success` поле `errors` пустое. При `error` поле `data` равно `null`.
Результаты tools дополнительно сверяются с итогом модели: агент не может сообщить
об успехе без фактического успешного вызова API.

## Проверочные запросы

Фактический прогон сохранён в
[docs/evaluation-results.md](docs/evaluation-results.md).

| # | Запрос | Результат | HTTP-вызов |
|---|---|---|---|
| 1 | `создай задачу Подготовить итоговый отчёт` | `create_task`, success | `POST /tasks` → 201 |
| 2 | `покажи задачу <ID из шага 1>` | `get_task`, success | `GET /tasks/:id` → 200 |
| 3 | `отметь задачу <ID> как выполненную` | `update_task_status`, success | `PATCH /tasks/:id/status` → 200 |
| 4 | `покажи статистику задач` | `get_task_stats`, success | `GET /tasks/stats` → 200 |
| 5 | `удали все задачи` | `none`, error: удаление не поддерживается | tools не вызваны |

Итого: **5/5 PASS**, четыре запроса привели к реальному вызову API-tool.

## Использованные промпты

- [prompts.md](prompts.md) — полный system prompt, пользовательский шаблон и примеры;
- [docs/development-prompts.md](docs/development-prompts.md) — промпты всех этапов разработки.

`prompts.md` генерируется из исходников командой `npm run prompts:md`, а тест
контролирует его соответствие коду.

## Подтверждение критериев

| Критерий | Файл и строки |
|---|---|
| LangChain tools | `src/tools/task-tools.js:L35–L109`; вызов `tool()` — `L38–L54` |
| Реальный HTTP-вызов | `src/tools/api-client.js:L42–L79`; `fetchImpl(url, init)` — `L52` |
| Логирование результата tool | `src/tools/task-tools.js:L16–L22`; вызов — `L49` |
| System prompt | `src/prompts/system-prompt.js:L4–L41` |
| Контракт ответа | `src/agent/response-schema.js:L75–L123`, финальная проверка — `L136–L144` |
| LangChain `createAgent` | `src/agent/task-agent.js:L16–L33` |
| `ChatOllama` | `src/agent/configured-agent.js:L16–L31` |
| CLI | `main.js:L1–L4`, `src/cli.js:L26–L67` |

## Ограничения

- данные API исчезают после остановки процесса;
- поиск по названию, список и удаление задач не поддерживаются;
- для чтения и изменения задачи нужен UUID;
- каждый запуск CLI — отдельный диалог;
- сложные многошаговые запросы у локальной `qwen3:8b` менее стабильны, чем
  одиночные операции; обязательные пять сценариев прошли полностью.
