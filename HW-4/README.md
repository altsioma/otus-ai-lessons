# dev-helper — MCP-сервер (stdio)

Домашнее задание «Простой MCP-сервер». Сервер на официальном TypeScript SDK (`@modelcontextprotocol/server` v2)
работает по stdio и даёт агенту четыре инструмента для работы с локальным демо-проектом корзины интернет-магазина.

> Статус: инструменты, контракты, песочница, логирование, тесты и конфигурация Claude Code готовы.
> Проверочные запросы и подтверждения вызовов — [`evidence/requests.md`](evidence/requests.md). Подтверждены вызовы из чата расширения Claude Code в VS Code (`entrypoint: claude-vscode`) и из сессии Claude Code CLI.

## Инструменты

| Tool | Что делает |
|---|---|
| `search_code` | ищет буквальный текст в файлах `demo-project/`, возвращает файл, строку, колонку и строку кода |
| `get_file_outline` | по AST TypeScript Compiler API возвращает экспорты `.ts`-файла: имя, вид, строку, сигнатуру, JSDoc, публичные члены классов |
| `lookup_docs` | ищет разделы в Markdown-базе `docs-kb/`, возвращает файл, заголовок, диапазон строк и фрагмент |
| `run_check` | запускает одну из разрешённых проверок демо-проекта: `test` или `typecheck` |

Входные и выходные схемы, формат ошибок и коды ошибок: [`docs/contract.md`](docs/contract.md)
(источник истины — Zod-схемы в [`src/contracts.ts`](src/contracts.ts)).

## Требования

- Node.js ≥ 22.18 (проверено на 22.23): тесты и демо-проект запускают `.ts` напрямую через встроенный type stripping
- npm (проверено на 10.9.8)

## Установка, сборка, проверка

```bash
cd HW-4
npm ci              # установка точных версий из package-lock.json
npm run build       # очистка dist/ и компиляция src/ → dist/
npm run typecheck   # tsc --noEmit по src/ и tests/
npm test            # сборка + все тесты (node:test), включая сквозной тест через MCP-клиент SDK
```

## Запуск

```bash
node dist/main.js
```

Сервер читает JSON-RPC из stdin и пишет ответы в stdout. Логи идут **только в stderr** (и в файл, если задан
`LOG_FILE`). Процесс завершается с кодом 0 при закрытии stdin, `SIGINT` или `SIGTERM`.

> Для MCP-клиента используйте `node dist/main.js`, а не `npm start`: npm печатает в stdout служебную строку,
> которая ломает протокол.

## Настройка

Все переменные необязательны, секретов нет. Пример — [`.env.example`](.env.example). Значения берутся из окружения
процесса (например, из конфигурации MCP-клиента); файл `HW-4/.env`, если он есть, подгружается без перезаписи уже
заданных переменных. Относительные пути считаются от каталога `HW-4/`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PROJECT_ROOT` | `demo-project` | единственный каталог, доступный `search_code`, `get_file_outline`, `run_check` |
| `DOCS_ROOT` | `docs-kb` | база знаний для `lookup_docs` |
| `LOG_FILE` | не задан | дополнительный JSON-lines лог (каталог `logs/` в `.gitignore`) |
| `CHECK_TIMEOUT_MS` | `60000` | таймаут `run_check`, 1000–300000 |

## Подключение к Claude Code

Конфигурация — [`.mcp.json`](.mcp.json) в корне `HW-4/` (project scope, транспорт stdio, сервер `dev-helper`).

1. Установите зависимости и соберите сервер: `cd HW-4 && npm ci && npm run build`.
2. Откройте `HW-4/` как рабочую папку в IDE с расширением Claude Code (или запустите `claude` в `HW-4/` либо любом его
   подкаталоге).
3. Когда Claude Code спросит про сервер `dev-helper` из `.mcp.json`, подтвердите его. Если запрос был закрыт — включите
   сервер в `/mcp`.
4. Выполните `/mcp`: `dev-helper` должен быть `connected`, инструментов — 4 (`search_code`, `get_file_outline`,
   `lookup_docs`, `run_check`).
5. Контрольный запрос: «Используй dev-helper: где в демо-проекте используется функция `applyDiscount`?» — агент вызывает
   `mcp__dev-helper__search_code`, в `logs/mcp-server.log` появляется запись `"tool":"search_code","status":"success"`.
   Указывайте `dev-helper` явно: без этого агент может ответить встроенным поиском (`grep`), не обращаясь к MCP-серверу.

**Как устроен запуск.** Claude Code запускает `node` с коротким загрузчиком в `-e`: он поднимается от текущего каталога
до ближайшего `.mcp.json` (так же ищет его и сам Claude Code) и импортирует `dist/main.js` рядом с ним. Это нужно потому,
что относительные пути в `args` Claude Code разрешает от каталога запуска, а `${CLAUDE_PROJECT_DIR}` в `args` не
подставляется (проверено на Claude Code 2.1.296: переменная только экспортируется в окружение сервера и равна каталогу запуска). Сервер запускается напрямую через Node.js, без `npm`. Передаётся одна
переменная — `LOG_FILE=logs/mcp-server.log` (путь считается от `HW-4/`, а не от каталога запуска); секретов нет.

### Если сервер не подключается

| Симптом | Причина и проверка |
|---|---|
| `dev-helper` нет в `/mcp` | Claude Code запущен вне `HW-4/` (например, в корне репозитория): `.mcp.json` ищется только вверх от каталога запуска. Проверка: `claude mcp get dev-helper` в `HW-4/`. |
| Статус «pending approval» / disabled | Сервер из `.mcp.json` не одобрен. Включите его в `/mcp`. |
| `failed`, в логе `dist/main.js not found` | Не выполнена сборка: `npm ci && npm run build`. |
| `failed` сразу после старта | Версия Node.js < 22.18 или ошибка конфигурации (`config_invalid` в stderr). Проверка: `node -v`; запуск `node dist/main.js` вручную в `HW-4/` — первой строкой в stderr должно быть `server_started`. |
| `connected`, но 0 инструментов / вызовы не доходят | `/mcp` → Reconnect. Подробности: `claude --debug=mcp`, лог в `~/.claude/debug/<session-id>.txt` (там же stderr сервера). |
| Агент отвечает без вызова инструмента | Уточните запрос: «используй dev-helper». Факт вызова виден в `logs/mcp-server.log` (`event: tool_call`). |
| `run_check` не выполняется | Claude Code спрашивает разрешение на вызов MCP-инструмента — подтвердите. |

### Сбор подтверждений вызовов

```bash
# транскрипт сессии IDE: ~/.claude/projects/<путь-к-HW-4 через дефисы>/<session-id>.jsonl
npm run evidence -- ~/.claude/projects/-Users-me-HW-4/<session-id>.jsonl ide-session
```

Скрипт [`scripts/collect-evidence.ts`](scripts/collect-evidence.ts) сохраняет в `evidence/traces/` только сведения о
сессии (включая `entrypoint`), запросы, вызовы и результаты `mcp__dev-helper__*` и ответы агента, а в
`evidence/server-log/` — записи `tool_call` из `logs/mcp-server.log` за время сессии. Таблица запросов —
[`evidence/requests.md`](evidence/requests.md).

## Логи

Каждый вызов инструмента даёт одну JSON-строку `tool_call`. Фрагмент stderr из ручного запуска
`node dist/main.js` с тремя `tools/call` (успех, отказ песочницы, отказ схемы):

```json
{"ts":"2026-10-12T17:26:32.606Z","level":"info","event":"tool_call","callId":"30efdfbd-bc89-4d9c-9ba3-18674fd8cdfa","tool":"search_code","args":{"query":"applyDiscount","path":"src","extensions":[".ts",".tsx",".js",".mjs",".json",".md"],"caseSensitive":false,"maxResults":20},"status":"success","durationMs":14}
{"ts":"2026-10-12T17:26:32.593Z","level":"warn","event":"tool_call","callId":"2c2068c5-46f3-4140-846c-bf94fbeeacfb","tool":"get_file_outline","args":{"path":"../.env"},"status":"error","durationMs":0,"errorCode":"PATH_OUTSIDE_ROOT","errorMessage":"Path \"../.env\" points outside the allowed directory"}
{"ts":"2026-10-12T17:26:32.594Z","level":"warn","event":"tool_call","tool":"run_check","args":{"check":"bash -c id"},"status":"error","durationMs":10,"stage":"sdk_validation","errorCode":"INVALID_INPUT","errorMessage":"Input validation error: Invalid arguments for tool run_check: check: Invalid option: expected one of \"test\"|\"typecheck\""}
```

Ошибка содержит `"status":"error"`, `errorCode` и `errorMessage`. Вызовы, которые SDK отклонил до обработчика
(невалидные параметры), логируются с `"stage":"sdk_validation"`. Аргументы перед записью проходят через `redact()`:
ключи вида `password|secret|token|apiKey|auth…` и строки, похожие на ключи (API-ключи, JWT, приватные ключи),
заменяются на `[REDACTED]`, длинные строки обрезаются.

## Безопасность

- **Файлы.** Доступ только внутри `PROJECT_ROOT` (и `DOCS_ROOT` для `lookup_docs`). Абсолютные пути и выход через `../`
  отклоняются (`PATH_OUTSIDE_ROOT`). Путь проверяется дважды: после нормализации и после `realpath` — симлинк,
  ведущий наружу, отклоняется. Файл открывается с `O_NOFOLLOW`, и после открытия сверяется, что дескриптор — тот же
  проверенный файл.
- **Запрещённые пути** (`ACCESS_DENIED`, при обходе каталогов — молча пропускаются): `.env`, `.env.*` (кроме
  `.env.example`), `.git/`, `node_modules/`, `.ssh/`, `.aws/`, `.gnupg/`, `.docker/`, `.kube/`, `*.pem`, `*.key`,
  `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.crt`, `*.cer`, `id_rsa*` и другие SSH-ключи, `.npmrc`, `.netrc`, `.pgpass`,
  `.git-credentials`, `credentials(.json)`, `secret(s).{json,yaml,yml,toml,env,txt,ini}`.
- **Лимиты.** Файл до 256 KB, бинарные файлы не читаются, обход до 2000 файлов и глубины 12, `search_code` — до 100
  совпадений, `lookup_docs` — до 5 разделов, вывод `run_check` — последние 4000 символов.
- **Команды.** `run_check` принимает только `test` или `typecheck`; команда и аргументы зашиты в коде
  ([`src/tools/runCheck.ts`](src/tools/runCheck.ts)). Запуск через `spawn` без shell, `cwd` = демо-проект, урезанное
  окружение (только `PATH` и временные каталоги, без токенов), таймаут с остановкой всей группы процессов.
- **Сообщения об ошибках** содержат только путь, переданный вызывающим, но не содержимое файлов и не реальные пути
  за пределами корня. Детали непредвиденных ошибок пишутся только в локальный лог.

## Структура

| Путь | Назначение |
|---|---|
| `src/main.ts` | точка входа: конфигурация, stdio-транспорт (`serveStdio`), завершение процесса |
| `src/server.ts` | создание `McpServer` и регистрация четырёх инструментов |
| `src/contracts.ts` | Zod-схемы входа/выхода, коды ошибок, описания инструментов |
| `src/tools/*.ts` | реализации инструментов |
| `src/security/sandbox.ts` | проверка путей, запрещённые файлы, безопасное чтение и обход каталогов |
| `src/withLogging.ts` | общая обёртка: лог вызова + преобразование результата/ошибки в `CallToolResult` |
| `src/protocolAudit.ts` | лог вызовов, отклонённых SDK до обработчика |
| `src/logger.ts`, `src/redact.ts` | JSON-логгер в stderr/файл и маскирование секретов |
| `src/config.ts` | чтение и проверка переменных окружения |
| `demo-project/` | демо-проект: корзина (`src/cart.ts`, `discounts.ts`, `pricing.ts`, `errors.ts`) и тесты |
| `docs-kb/` | база знаний: округление цен, скидки, обработка ошибок, проверки качества |
| `docs/contract.md` | контракты инструментов |
| `tests/` | тесты песочницы, каждого инструмента, контрактов, логирования, stdio и MCP-клиента |
| `.mcp.json` | подключение сервера к Claude Code |
| `scripts/collect-evidence.ts` | выжимка подтверждений вызовов из транскрипта Claude Code и серверного лога |
| `evidence/` | проверочные запросы, трассы, серверные логи, скриншоты |
