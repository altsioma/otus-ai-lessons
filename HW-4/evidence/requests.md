# Проверочные запросы к агенту

Обязательная часть задания — запросы к агенту Claude Code в IDE (рабочая папка `HW-4/`).
Подтверждения собираются из реальных источников:

- `evidence/traces/<name>.jsonl` — выжимка из транскрипта сессии Claude Code (`~/.claude/projects/…/<session-id>.jsonl`):
  `entrypoint` сессии, запросы пользователя, `tool_use`/`tool_result` для `mcp__dev-helper__*`, ответы агента.
  Создаётся командой `npm run evidence -- <transcript.jsonl> <name>`; поле `ideBridge` показывает, подключился ли мост Claude Code к IDE;
- `evidence/server-log/<name>.jsonl` — записи `tool_call` из `logs/mcp-server.log` (инструмент, параметры, статус, длительность)
  за то же время;
- `evidence/screenshots/` — скриншоты сессии Claude Code.

Статусы: **подтверждено** — вызов есть в трассе Claude Code и в серверном логе (скриншот — где указан).

## Сессия в IDE: VS Code, расширение Claude Code (2026-10-12)

- Трасса: [`traces/vscode-session-5306ccc9.jsonl`](traces/vscode-session-5306ccc9.jsonl), серверный лог:
  [`server-log/vscode-session-5306ccc9.jsonl`](server-log/vscode-session-5306ccc9.jsonl),
  скриншот: [`screenshots/ide-01.png`](screenshots/ide-01.png).
- Транскрипт сессии `5306ccc9-1803-4499-88b2-81ee718f3a60`: `entrypoint: "claude-vscode"` (чат расширения
  Claude Code в VS Code), Claude Code 2.1.296, `cwd` = `HW-4/`. На скриншоте — панель расширения в VS Code с запросом
  и вызовом `Dev-helper [run_check]`.

| # | Запрос пользователя (как отправлен) | Ожидаемый инструмент | Фактически вызванный | Результат | Подтверждение | Статус |
|---|---|---|---|---|---|---|
| I1 | Используй dev-helper: где в демо-проекте используется функция calculateTotal? | `search_code` | `mcp__dev-helper__search_code` `{"query":"calculateTotal","maxResults":50}` | success, 5 совпадений в 2 файлах | трасса 17:51:53Z; лог `callId` `8f83e38a…`, `durationMs` 13 | подтверждено |
| I2 | Используй dev-helper: покажи публичный API файла src/discounts.ts | `get_file_outline` | `mcp__dev-helper__get_file_outline` `{"path":"src/discounts.ts"}` | success, 4 экспорта | трасса 17:52:26Z; лог `07d0ef06…`, `durationMs` 19 | подтверждено |
| I3 | Используй dev-helper: какие ограничения есть у скидок по документации? | `lookup_docs` | `mcp__dev-helper__lookup_docs` `{"topic":"ограничения скидок: процентная и фиксированная скидка, правила валидации","maxSections":5}` | success, раздел «Скидки > Ограничения» в `discounts.md` (строки 12–19) | трасса 17:52:55Z; лог `1ddb207a…`, `durationMs` 8; запрос виден на [скриншоте](screenshots/ide-01.png) | подтверждено |
| I4 | Используй dev-helper: запусти проверку типов демо-проекта | `run_check` (`typecheck`) | `mcp__dev-helper__run_check` `{"check":"typecheck"}` | success, `passed: true`, 0 ошибок типов | трасса 17:53:14Z; лог `2a4741a2…`, `durationMs` 282; [скриншот](screenshots/ide-01.png) | подтверждено |

Все 4 запроса из IDE привели к реальному вызову MCP-инструмента; каждый вызов есть и в транскрипте, и в серверном
логе с теми же параметрами (разница по времени ≤ 0,6 с). Перед каждым вызовом агент загружал схему инструмента через
встроенный `ToolSearch`; других инструментов в этих ответах он не вызывал.

## Сессия в IDE №2: VS Code, расширение Claude Code (2026-10-12)

- Трасса: [`traces/vscode-session-447d7630.jsonl`](traces/vscode-session-447d7630.jsonl), серверный лог:
  [`server-log/vscode-session-447d7630.jsonl`](server-log/vscode-session-447d7630.jsonl), скриншоты:
  [`02-ide-run_check.png`](screenshots/02-ide-run_check.png), [`03-ide-get_file_outline.png`](screenshots/03-ide-get_file_outline.png), [`04-ide-no_tool.png`](screenshots/04-ide-no_tool.png).
- Транскрипт сессии `447d7630-acf5-4b39-be7d-5fd278ddcd19`: `entrypoint: "claude-vscode"`, Claude Code 2.1.296, `cwd` = `HW-4/`.

| # | Запрос пользователя (как отправлен) | Ожидаемый инструмент | Фактически вызванный | Результат | Подтверждение | Статус |
|---|---|---|---|---|---|---|
| I5 | Используй dev-helper: запусти тесты демо-проекта | `run_check` (`test`) | `mcp__dev-helper__run_check` `{"check":"test"}` | success, `passed: true`, 8/8 тестов | трасса 18:06:16Z; лог `callId` `e650619b…`, `durationMs` 121; [скриншот](screenshots/02-ide-run_check.png) | подтверждено |
| I6 | Используй dev-helper: покажи outline файла ../src/server.ts | `get_file_outline` → `PATH_OUTSIDE_ROOT` | `mcp__dev-helper__get_file_outline` `{"path":"../src/server.ts"}`, затем по своей инициативе `{"path":"src/server.ts"}` | `isError: true`, `PATH_OUTSIDE_ROOT`; повторная попытка — `NOT_FOUND` (в демо-проекте такого файла нет) | трасса 18:06:31Z и 18:06:34Z; лог `de394ee2…` и `d51bc783…`, `status: error`; [скриншот](screenshots/03-ide-get_file_outline.png) | подтверждено |
| I7 | как работает mcp ? (контрольный, без подсказки) | не вызывается | инструменты не вызывались (ни `dev-helper`, ни другие) | ответ из общих знаний | трасса: после `user_prompt` 18:06:51Z нет `tool_use`; в серверном логе записей нет; [скриншот](screenshots/04-ide-no_tool.png) | подтверждено (контрольный) |

## Сессия Claude Code CLI без подключения к IDE (2026-10-12)

- Трасса: [`traces/claude-session-cd800b44.jsonl`](traces/claude-session-cd800b44.jsonl), серверный лог:
  [`server-log/claude-session-cd800b44.jsonl`](server-log/claude-session-cd800b44.jsonl), скриншоты: [`screenshots/`](screenshots/).
- Интерактивная сессия Claude Code 2.1.296, `cwd` = `HW-4/`, `entrypoint: "cli"`. Сервер `dev-helper` одобрен и
  подключён: на [`screenshots/00-mcp-status.png`](screenshots/00-mcp-status.png) видны «Project MCPs (…/HW-4/.mcp.json)»,
  `✔ dev-helper`, 4 tools.
- **Ограничение.** В транскрипте записано, что встроенный мост Claude Code к IDE (внутренний MCP-сервер `ide`) не
  подключился: `"failedMcpServers":[{"name":"ide","error":"WebSocket is not open. Cannot start transport."}]`
  (поле `ideBridge` в трассе). Это CLI-сессия, связь с IDE в ней не установлена; вызовы из чата расширения IDE
  этой сессией не подтверждаются.

| # | Запрос пользователя (как отправлен) | Ожидаемый инструмент | Фактически вызванный | Результат | Подтверждение | Статус |
|---|---|---|---|---|---|---|
| 1a | Где в демо-проекте используется функция applyDiscount? | `search_code` | **MCP не вызван**: агент выполнил `grep -rn "applyDiscount"` через Bash (17:36:12Z) | ответ верный (6 мест), но без MCP | трасса: `user_prompt` 17:36:09Z; в серверном логе записи нет | не засчитан |
| 1b | Используй dev-helper  Где в демо-проекте используется функция applyDiscount? | `search_code` | `mcp__dev-helper__search_code` `{"query":"applyDiscount","caseSensitive":true,"maxResults":100}` | success, 6 совпадений в 3 файлах | трасса 17:37:43Z; лог `callId` `98430950…`, `durationMs` 14 | подтверждено |
| 1c | Где в демо-проекте используется функция applyDiscount? → search_code | `search_code` | `mcp__dev-helper__search_code` (те же параметры) | success, 6 совпадений | трасса 17:40:10Z; лог `1a0e398b…`; [скриншот](screenshots/01-search_code.png) | подтверждено |
| 2a | Используй dev-helper:  Покажи публичный API файла src/cart.ts демо-проекта | `get_file_outline` | `mcp__dev-helper__get_file_outline` `{"path":"src/cart.ts"}` | success, 5 экспортов | трасса 17:38:20Z; лог `39c736d8…` | подтверждено |
| 2b | Покажи публичный API файла src/cart.ts демо-проекта → get_file_outline | `get_file_outline` | `mcp__dev-helper__get_file_outline` `{"path":"src/cart.ts"}` | success, 5 экспортов | трасса 17:40:26Z; лог `66fc72ec…`; [скриншот](screenshots/02-get_file_outline.png) | подтверждено |
| 3 | Как по документации проекта округляются цены? → lookup_docs | `lookup_docs` | `mcp__dev-helper__lookup_docs` `{"topic":"округление цен"}` | success, лучший раздел `pricing-rounding.md` «Правило округления» | трасса 17:40:41Z; лог `a52c11e2…`; [скриншот](screenshots/03-lookup_docs.png) | подтверждено |
| 4 | Запусти тесты демо-проекта и скажи, все ли проходят → run_check | `run_check` (`test`) | `mcp__dev-helper__run_check` `{"check":"test"}` | success, `passed: true`, 8/8 тестов | трасса 17:41:03Z; лог `3b6d2009…`, `durationMs` 121; [скриншот](screenshots/04-run_check.png) | подтверждено |
| 5 | Вызови get_file_outline для пути ../src/server.ts → get_file_outline | `get_file_outline` → `PATH_OUTSIDE_ROOT` | `mcp__dev-helper__get_file_outline` `{"path":"../src/server.ts"}` | `isError: true`, `PATH_OUTSIDE_ROOT` — отказ песочницы, как ожидалось | трасса 17:41:32Z; лог `4474fd06…`, `status: error`; [скриншот](screenshots/05-get_file_outline.png) | подтверждено |
| 6 | Чем stdio-транспорт MCP отличается от HTTP? | `dev-helper` не вызывается | `dev-helper` не вызван; агент обратился к **другому** MCP-серверу пользователя, context7 (`resolve-library-id`, `query-docs`) | ответ по документации MCP | трасса: нет `tool_use` dev-helper после 17:41:49Z; [скриншот](screenshots/06-no-tool.png) | подтверждено (контрольный) |

Замечания:

- В запросах 1b и 2a добавлено «Используй dev-helper», в 1c, 2b и 3–5 — подсказка «→ имя_инструмента» прямо в тексте.
  Без подсказки (1a) агент выбрал встроенный поиск, а не MCP-инструмент.
- Итого: 6 разных запросов, 5 из них привели к реальному вызову инструментов `dev-helper` (7 вызовов, все 7 есть в
  серверном логе с совпадающими параметрами и временем).

## Дополнительно: CLI-трасса (не заменяет демонстрацию в IDE)

Запуск `claude -p` из `HW-4/demo-project` с той же конфигурацией (`--mcp-config ../.mcp.json --strict-mcp-config`,
модель haiku, `--output-format stream-json`). Подтверждает, что Claude Code принимает `.mcp.json`, сервер стартует
из подкаталога и агент вызывает инструмент.

| Запрос | Ожидаемый инструмент | Фактически вызванный | Результат | Подтверждение | Статус |
|---|---|---|---|---|---|
| Где в нашем демо-проекте используется функция applyDiscount? Используй инструменты dev-helper. | `search_code` | `mcp__dev-helper__search_code` `{"query":"applyDiscount","caseSensitive":true,"maxResults":100}` | success, 6 совпадений в 3 файлах | [трасса](traces/cli-01-search_code.jsonl), [серверный лог](server-log/cli-01-search_code.jsonl) (`callId` `0bb172d4-…`, `durationMs` 18) | подтверждено (CLI, 2026-10-12) |
