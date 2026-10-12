# Отчёт: «Простой MCP-сервер»

Сервер `dev-helper`: MCP-сервер на TypeScript с четырьмя инструментами для работы с локальным демо-проектом, подключённый к Claude Code.
Все факты ниже проверены по файлам репозитория и по результатам запусков 2026-10-12 (Node.js 22.23.0, Claude Code 2.1.296).
Ссылки на код даны с диапазонами строк по текущему состоянию файлов.

## 1. Цель и назначение

Агенту в IDE часто нужен точный контекст проекта: где используется функция, какой у файла публичный API,
что говорит внутренняя документация, проходят ли тесты. Сервер `dev-helper` даёт агенту эти операции как MCP-инструменты
со строгими схемами и структурированными ответами. Агенту не нужно разбирать вывод `grep` или запускать произвольные
shell-команды. В ТЗ это совпадает со всеми тремя предложенными направлениями: Doc/Code context (`lookup_docs`),
Project helper (`search_code`, `get_file_outline`) и DevOps/tooling (`run_check` с белым списком).

Рабочие данные:
- [`demo-project/`](demo-project/) — небольшой TypeScript-модуль корзины: `cart.ts`, `discounts.ts`, `pricing.ts`, `errors.ts`, 8 тестов на `node:test`;
- [`docs-kb/`](docs-kb/) — 4 Markdown-документа с правилами проекта: округление цен, скидки, обработка ошибок, проверки качества.

### Как IDE подключается к MCP-серверу и что здесь считается tool

Claude Code (CLI или расширение IDE) читает проектный [`.mcp.json`](.mcp.json) и запускает сервер как дочерний процесс.
Обмен идёт по транспорту **stdio**: клиент пишет JSON-RPC-сообщения в stdin сервера и читает ответы из его stdout.
После рукопожатия `initialize` клиент запрашивает `tools/list` и получает имена, описания и JSON Schema входа и выхода
инструментов. Когда модель решает воспользоваться инструментом, клиент отправляет `tools/call` с аргументами и передаёт
результат модели. В Claude Code инструменты сервера видны под именами `mcp__dev-helper__<tool>`.

**Tool** в этом сервере — именованная операция, которая регистрируется через `McpServer.registerTool` и состоит из:
- описания для модели;
- Zod-схемы входа, по которой SDK проверяет аргументы до вызова обработчика;
- Zod-схемы выхода, по которой SDK проверяет успешный результат;
- обработчика, который возвращает `structuredContent` (JSON-объект по схеме) и его текстовую копию в `content`.

Ошибки возвращаются как результат с `isError: true` и объектом `{ error: { code, message } }`.

## 2. Технологии и архитектура

| Компонент | Выбор | Где зафиксировано |
|---|---|---|
| Язык и рантайм | TypeScript 6.0.3 (strict, ESM), Node.js ≥ 22.18 | [`package.json`](package.json), [`tsconfig.json`](tsconfig.json) |
| MCP SDK | `@modelcontextprotocol/server` 2.3.1 (официальный TypeScript SDK v2), `zod` 4.6.7 | [`package.json`](package.json), [`package-lock.json`](package-lock.json) — точные версии |
| Транспорт | stdio через `serveStdio` | [`src/main.ts:L24–L27`](src/main.ts#L24-L27) |
| Разбор TypeScript | TypeScript Compiler API (AST) | [`src/tools/getFileOutline.ts`](src/tools/getFileOutline.ts) |
| Тесты | встроенный `node:test`, интеграционный тест через `@modelcontextprotocol/client` 2.3.1 | [`tests/`](tests/) |
| Менеджер пакетов | npm, `package-lock.json` | — |

Поток вызова:

```
Claude Code ──stdio/JSON-RPC──▶ AuditedTransport ──▶ McpServer (SDK: проверка схем)
                                  (лог отказов SDK)        │
                                                           ▼
                                  withLogging (лог вызова) ──▶ tools/*.ts ──▶ security/sandbox.ts ──▶ demo-project/, docs-kb/
```

| Что | Файл и строки |
|---|---|
| Создание сервера и регистрация четырёх инструментов | [`src/server.ts:L20–L46`](src/server.ts#L20-L46) (`registerTool`: L24–L28, L29–L33, L34–L38, L39–L43) |
| Точка входа: конфигурация, stdio-транспорт, завершение по EOF/SIGINT/SIGTERM | [`src/main.ts:L13–L60`](src/main.ts#L13-L60) |
| Конфигурация из переменных окружения (пути считаются от `HW-4/`) | [`src/config.ts:L31–L53`](src/config.ts#L31-L53) |
| Контракты (Zod-схемы, коды ошибок, описания инструментов) | [`src/contracts.ts:L6–L195`](src/contracts.ts#L6-L195) |
| Общая обёртка логирования и формирования результата | [`src/withLogging.ts:L14–L46`](src/withLogging.ts#L14-L46) |
| Песочница файлового доступа | [`src/security/sandbox.ts`](src/security/sandbox.ts) |

Диагностика пишется только в stderr. stdout занят протоколом: в нём нет ничего, кроме JSON-RPC, и это проверяет
тест [`tests/stdio.test.ts:L55`](tests/stdio.test.ts#L55).

## 3. Реализованные инструменты

Полные схемы описаны в [`docs/contract.md`](docs/contract.md), источник истины — [`src/contracts.ts`](src/contracts.ts).

### `search_code`
- **Назначение:** поиск буквального текста (не regex) в файлах демо-проекта. Одно совпадение на строку, файлы в стабильном порядке.
- **Вход:** `query` (1–200 символов), `path` (по умолчанию `"."`), `extensions` (по умолчанию `.ts .tsx .js .mjs .json .md`), `caseSensitive` (false), `maxResults` (1–100, по умолчанию 20).
- **Результат:** `matches[{file, line, column, text}]`, `totalMatches`, `filesScanned`, `filesSkipped`, `truncated`.
- **Реализация:** [`src/tools/searchCode.ts:L9–L58`](src/tools/searchCode.ts#L9-L58). Схемы: [`src/contracts.ts:L43–L73`](src/contracts.ts#L43-L73).
- **Пример из IDE:** «Используй dev-helper: где в демо-проекте используется функция calculateTotal?» → 5 совпадений в 2 файлах (строка I1 в [`evidence/requests.md`](evidence/requests.md)).

### `get_file_outline`
- **Назначение:** публичный API TypeScript-файла по AST Compiler API, без регулярных выражений.
- **Вход:** `path` — `.ts`, `.tsx`, `.mts` или `.cts` относительно корня демо-проекта.
- **Результат:** `file`, `totalExports`, `exports[{name, kind, line, signature, isDefault, jsDoc, members[]}]`. В `members` попадают публичные члены классов и интерфейсов: приватные (`#x`, `private`, `protected`) отбрасываются.
- **Реализация:** [`src/tools/getFileOutline.ts:L20–L30`](src/tools/getFileOutline.ts#L20-L30) (точка входа), разбор AST — класс `OutlineBuilder` [`L32–L219`](src/tools/getFileOutline.ts#L32-L219). Схемы: [`src/contracts.ts:L77–L106`](src/contracts.ts#L77-L106).
- **Пример из IDE:** «Используй dev-helper: покажи публичный API файла src/discounts.ts» → 4 экспорта (I2).

### `lookup_docs`
- **Назначение:** детерминированный поиск разделов в `docs-kb/*.md` без сети и эмбеддингов. Слова сводятся к короткой основе, чтобы совпадали формы слова; за совпадение в заголовке начисляется +3, в тексте +1 (не больше 3 на основу).
- **Вход:** `topic` (2–200 символов), `maxSections` (1–5, по умолчанию 3).
- **Результат:** `terms`, `results[{source, heading, headingPath, lineStart, lineEnd, excerpt, score}]`, `documentsSearched`, `sectionsSearched`.
- **Реализация:** [`src/tools/lookupDocs.ts:L84–L111`](src/tools/lookupDocs.ts#L84-L111). Разбор Markdown: [`L44–L71`](src/tools/lookupDocs.ts#L44-L71), подсчёт очков: [`L73–L82`](src/tools/lookupDocs.ts#L73-L82). Схемы: [`src/contracts.ts:L110–L131`](src/contracts.ts#L110-L131).
- **Пример из IDE:** «Используй dev-helper: какие ограничения есть у скидок по документации?» → раздел «Скидки > Ограничения», `discounts.md`, строки 12–19 (I3).

### `run_check`
- **Назначение:** запуск одной из заранее разрешённых проверок демо-проекта.
- **Вход:** `check` — только `"test"` или `"typecheck"`, лишние поля запрещены.
- **Результат:** `check`, `command`, `exitCode`, `passed`, `durationMs`, `summary{testsPassed, testsFailed, typeErrors}`, `output` (хвост до 4000 символов), `outputTruncated`. Непрошедшие тесты — это успешный вызов с `passed: false`.
- **Реализация:** [`src/tools/runCheck.ts:L57–L77`](src/tools/runCheck.ts#L57-L77). Белый список команд: [`L25–L46`](src/tools/runCheck.ts#L25-L46), запуск процесса: [`L79–L123`](src/tools/runCheck.ts#L79-L123). Схемы: [`src/contracts.ts:L135–L154`](src/contracts.ts#L135-L154).
- **Примеры из IDE:** «Используй dev-helper: запусти проверку типов демо-проекта» → `passed: true`, 0 ошибок типов (I4, есть скриншот); «Используй dev-helper: запусти тесты демо-проекта» → `passed: true`, 8 из 8 тестов (I5).

## 4. Контракты и ошибки

- **Входные данные** проверяет SDK по Zod-схемам до вызова обработчика. Все объекты строгие (`z.strictObject`): лишние поля отклоняются. Невалидный вызов возвращается как `isError: true` с текстом `Input validation error: …` и до обработчика не доходит.
- **Успешный ответ:** `structuredContent` по `outputSchema` (SDK проверяет его перед отправкой) плюс текстовая копия в `content`. Формирование ответа: [`src/withLogging.ts:L24–L27`](src/withLogging.ts#L24-L27).
- **Ошибка инструмента:** `isError: true`, `structuredContent: { error: { code, message } }`. Схема: [`src/contracts.ts:L24–L29`](src/contracts.ts#L24-L29), формирование: [`src/withLogging.ts:L28–L43`](src/withLogging.ts#L28-L43). Ожидаемые ошибки выбрасываются как `ToolError` ([`src/errors.ts`](src/errors.ts)). Непредвиденные превращаются в `INTERNAL_ERROR` с общим сообщением, а исходный текст ошибки попадает только в локальный лог (`cause`).
- **Коды ошибок** (11 штук) перечислены в [`src/contracts.ts:L6–L18`](src/contracts.ts#L6-L18) и описаны в [`docs/contract.md`, раздел «Коды ошибок»](docs/contract.md#коды-ошибок): `INVALID_INPUT`, `PATH_OUTSIDE_ROOT`, `ACCESS_DENIED`, `NOT_FOUND`, `NOT_A_FILE`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `CHECK_NOT_ALLOWED`, `TIMEOUT`, `EXECUTION_FAILED`, `INTERNAL_ERROR`.
- **Соответствие документации и кода** проверяется тестом [`tests/contracts.test.ts:L46`](tests/contracts.test.ts#L46): каждое поле и значение enum из JSON Schema должно быть упомянуто в разделе инструмента в `docs/contract.md`, каждый код ошибки — в документе.

## 5. Безопасность

Ниже только механизмы, которые реально есть в коде:

- **Доступ только внутри корня.** [`resolveSafePath`, `src/security/sandbox.ts:L54–L75`](src/security/sandbox.ts#L54-L75):
  1. абсолютные пути и NUL-байты отклоняются;
  2. путь проверяется после нормализации (`../` даёт `PATH_OUTSIDE_ROOT`);
  3. затем ещё раз после `realpath`, так что симлинк, ведущий наружу, тоже даёт `PATH_OUTSIDE_ROOT`;
  4. на обоих шагах проверяется список запрещённых путей.

  Корни — `demo-project/` для `search_code`, `get_file_outline`, `run_check` и `docs-kb/` для `lookup_docs`.
- **Запрещённые пути** ([`L19–L28`](src/security/sandbox.ts#L19-L28)): `.env`, `.env.*` (кроме `.env.example`), `.git/`, `node_modules/`, `.ssh/`, `.aws/`, ключи и сертификаты (`*.pem`, `*.key`, `id_rsa*` и др.), `.npmrc`, `.netrc` и другие. Прямой доступ даёт `ACCESS_DENIED`, при обходе каталогов такие файлы пропускаются.
- **Безопасное чтение** ([`L82–L110`](src/security/sandbox.ts#L82-L110)): открытие с `O_NOFOLLOW`; после открытия сверяются inode и устройство с проверенным путём. Читается только обычный файл до 256 KB, бинарные файлы отклоняются.
- **Лимиты** ([`L13–L17`](src/security/sandbox.ts#L13-L17)): 256 KB на файл, до 2000 файлов и глубина обхода 12. В схемах: `maxResults ≤ 100`, `maxSections ≤ 5`. Вывод `run_check` — последние 4000 символов.
- **Запрет произвольных команд** ([`src/tools/runCheck.ts:L25–L46`, `L79–L123`](src/tools/runCheck.ts#L25-L46)):
  - замороженный список из двух команд с фиксированным argv;
  - `spawn` без shell, `cwd` = демо-проект;
  - окружение урезано до `PATH` и временных каталогов, токены не передаются;
  - таймаут `CHECK_TIMEOUT_MS` (по умолчанию 60 с) убивает всю группу процессов (`SIGKILL`) и даёт ошибку `TIMEOUT`.
- **Сообщения об ошибках** содержат только путь, переданный вызывающим, — не содержимое файлов и не реальные пути за пределами корня. Это проверяет [`tests/sandbox.test.ts`](tests/sandbox.test.ts).
- **Логирование вызовов:**
  - каждый выполненный вызов даёт JSON-строку `tool_call` с `tool`, `args`, `status`, `durationMs`, а при ошибке ещё `errorCode` и `errorMessage` ([`src/withLogging.ts:L26`](src/withLogging.ts#L26), [`L31–L41`](src/withLogging.ts#L31-L41));
  - вызовы, отклонённые SDK до обработчика, логирует [`src/protocolAudit.ts:L57–L74`](src/protocolAudit.ts#L57-L74) с `stage: "sdk_validation"`;
  - запись идёт в stderr и в `LOG_FILE` ([`src/logger.ts:L38–L50`](src/logger.ts#L38-L50));
  - перед записью аргументы проходят через `redact()` ([`src/redact.ts:L19–L34`](src/redact.ts#L19-L34)): чувствительные ключи и строки, похожие на ключи и токены, заменяются на `[REDACTED]`.
- **Секреты в Git.** Сервер не использует секретов, а [`.env.example`](.env.example) содержит только пути и таймаут. `.env`, `logs/`, `dist/` и `node_modules/` перечислены в [`.gitignore`](.gitignore). Поиск по шаблонам ключей (`sk-…`, `AKIA…`, `PRIVATE KEY`, email) в файлах, которые попадут в Git, ничего не нашёл. Фиктивные ключи в тестах собираются во время выполнения.

## 6. Подключение к Claude Code

[`.mcp.json`](.mcp.json) — проектная конфигурация: сервер `dev-helper`, `type: "stdio"`, `command: "node"`.
В `args` — короткий загрузчик для `node -e`. Он поднимается от текущего каталога до ближайшего `.mcp.json` и
импортирует `dist/main.js` рядом с ним; если сборки нет, пишет понятную ошибку в stderr. Сервер запускается
напрямую через Node.js, без `npm start` (npm печатает служебную строку в stdout).

Почему загрузчик: проверка на Claude Code 2.1.296 показала, что
- `.mcp.json` находится и при запуске из подкаталога;
- относительные пути в `args` считаются от каталога запуска;
- `${CLAUDE_PROJECT_DIR}` в `args` не подставляется.

Загрузчик проверен из `HW-4/`, `demo-project/`, `demo-project/src/` и `docs-kb/`. Передаётся одна переменная окружения,
`LOG_FILE=logs/mcp-server.log`; секретов в конфиге нет.

Шаги подключения ([`README.md`, раздел «Подключение к Claude Code»](README.md#подключение-к-claude-code)):
1. `npm ci && npm run build`.
2. Открыть `HW-4/` в IDE с расширением Claude Code.
3. Одобрить проектный сервер `dev-helper`.
4. Выполнить `/mcp`: сервер в статусе `connected`, 4 инструмента ([скриншот](evidence/screenshots/00-mcp-status.png)).
5. Отправить контрольный запрос с явным упоминанием сервера: «Используй dev-helper: где в демо-проекте используется функция `applyDiscount`?».

Там же есть таблица типичных причин неподключения и способов диагностики (`claude mcp get`, `claude --debug=mcp`).

## 7. Тестирование

Команды (из [`README.md`](README.md#установка-сборка-проверка)): `npm ci`, `npm run build`, `npm run typecheck`, `npm test`.
`npm test` собирает проект и запускает `node --test "tests/**/*.test.ts"`.

Результат прогона при подготовке отчёта (2026-10-12, Node.js 22.23.0):

| Проверка | Результат |
|---|---|
| `npm run build` | код выхода 0 |
| `npm run typecheck` | код выхода 0 |
| `npm test` | `# tests 58`, `# pass 58`, `# fail 0`, `# suites 16` |

Распределение по файлам (тот же прогон, каждый файл отдельно):

| Файл | Тестов | Что проверяет |
|---|---|---|
| [`sandbox.test.ts`](tests/sandbox.test.ts) | 13 | `../`, абсолютные пути, NUL, симлинки наружу (на файл и каталог), запрещённые файлы (в том числе через симлинк), лимит размера, бинарные файлы, обход каталогов |
| [`lookupDocs.test.ts`](tests/lookupDocs.test.ts) | 8 | поиск на русском и английском, пустой результат, стоп-слова, невалидный ввод, диапазоны строк |
| [`contracts.test.ts`](tests/contracts.test.ts) | 7 | 4 инструмента, строгие схемы, сверка `docs/contract.md` со схемами |
| [`logging.test.ts`](tests/logging.test.ts) | 6 | записи успеха и ошибки, маскирование секретов, запись в файл |
| [`runCheck.test.ts`](tests/runCheck.test.ts) | 6 | `test` и `typecheck`, таймаут ([L28](tests/runCheck.test.ts#L28)), отказ от произвольных команд ([L32](tests/runCheck.test.ts#L32)), фиксированный argv |
| [`searchCode.test.ts`](tests/searchCode.test.ts) | 6 | успешный и пустой поиск, параметры, `NOT_FOUND`, отсутствие утечек из запрещённых файлов |
| [`getFileOutline.test.ts`](tests/getFileOutline.test.ts) | 5 | экспорты `cart.ts`, типы и константы, re-export и default, отказы |
| [`mcp.integration.test.ts`](tests/mcp.integration.test.ts) | 5 | `dist/main.js` через `StdioClientTransport` SDK: `tools/list` (4 инструмента со схемами), `tools/call` каждого, `isError`, отказ SDK, записи в лог-файле |
| [`stdio.test.ts`](tests/stdio.test.ts) | 2 | рукопожатие и вызов через «сырой» stdio, чистота stdout, завершение по EOF и `SIGTERM` |

Тесты подтверждают **корректность поведения** на контролируемых данных. Вызовы из агента Claude Code они не заменяют
и в доказательства вызовов из IDE не засчитываются.

## 8. Практическая демонстрация

Источник — [`evidence/requests.md`](evidence/requests.md). Происхождение каждой сессии указано явно: две сессии из IDE
(A1, A2) и две дополнительные из CLI (B, C).

**A. IDE — чат расширения Claude Code в VS Code.** В транскриптах обеих сессий записано `entrypoint: "claude-vscode"`,
`cwd` = `HW-4/`.

| # | Сессия | Запрос (как отправлен) | Вызов `dev-helper` | Результат |
|---|---|---|---|---|
| I1 | A1 `5306ccc9…` | Используй dev-helper: где в демо-проекте используется функция calculateTotal? | `search_code {"query":"calculateTotal","maxResults":50}` | success, 5 совпадений в 2 файлах |
| I2 | A1 | Используй dev-helper: покажи публичный API файла src/discounts.ts | `get_file_outline {"path":"src/discounts.ts"}` | success, 4 экспорта |
| I3 | A1 | Используй dev-helper: какие ограничения есть у скидок по документации? | `lookup_docs {…,"maxSections":5}` | success, `discounts.md` L12–L19 |
| I4 | A1 | Используй dev-helper: запусти проверку типов демо-проекта | `run_check {"check":"typecheck"}` | success, 0 ошибок типов ([скриншот](evidence/screenshots/ide-01.png)) |
| I5 | A2 `447d7630…` | Используй dev-helper: запусти тесты демо-проекта | `run_check {"check":"test"}` | success, `passed: true`, 8 из 8 ([скриншот](evidence/screenshots/02-ide-run_check.png)) |
| I6 | A2 | Используй dev-helper: покажи outline файла ../src/server.ts | `get_file_outline {"path":"../src/server.ts"}`, затем агент сам повторил с `{"path":"src/server.ts"}` | `PATH_OUTSIDE_ROOT`; повтор — `NOT_FOUND` ([скриншот](evidence/screenshots/03-ide-get_file_outline.png)) |
| I7 | A2 | как работает mcp ? (без подсказки) | не вызывался; других инструментов агент тоже не вызывал | контрольный, ответ из общих знаний ([скриншот](evidence/screenshots/04-ide-no_tool.png)) |

Обязательные примеры, все из IDE:

- **Успешный вызов** (I2), строка 2 файла [`evidence/server-log/vscode-session-5306ccc9.jsonl`](evidence/server-log/vscode-session-5306ccc9.jsonl):
  ```json
  {"ts":"2026-10-12T17:52:26.809Z","level":"info","event":"tool_call","callId":"07d0ef06-bdfa-493a-8c9a-1dc905d7de48","tool":"get_file_outline","args":{"path":"src/discounts.ts"},"status":"success","durationMs":19}
  ```
- **Запуск тестов через `run_check`** (I5), строка 1 файла [`evidence/server-log/vscode-session-447d7630.jsonl`](evidence/server-log/vscode-session-447d7630.jsonl):
  ```json
  {"ts":"2026-10-12T18:06:17.084Z","level":"info","event":"tool_call","callId":"e650619b-e5db-415e-ab03-08bfc509fc6d","tool":"run_check","args":{"check":"test"},"status":"success","durationMs":121}
  ```
- **Отказ с `PATH_OUTSIDE_ROOT`** (I6), строка 2 того же файла:
  ```json
  {"ts":"2026-10-12T18:06:31.895Z","level":"warn","event":"tool_call","callId":"de394ee2-9da5-4a9b-9525-b30ac818a68a","tool":"get_file_outline","args":{"path":"../src/server.ts"},"status":"error","durationMs":0,"errorCode":"PATH_OUTSIDE_ROOT","errorMessage":"Path \"../src/server.ts\" points outside the allowed directory"}
  ```
  Клиент получил `isError: true` и `{"error":{"code":"PATH_OUTSIDE_ROOT",…}}` (`tool_result` в трассе
  [`evidence/traces/vscode-session-447d7630.jsonl`](evidence/traces/vscode-session-447d7630.jsonl)). На [скриншоте](evidence/screenshots/03-ide-get_file_outline.png) видны оба вызова: `Dev-helper [get_file_outline] ../src/server.ts` с `PATH_OUTSIDE_ROOT` и повтор с `NOT_FOUND`.
- **Контрольный запрос без вызова** (I7): в трассе после запроса нет ни одного `tool_use`, в серверном логе нет записей; на [скриншоте](evidence/screenshots/04-ide-no_tool.png) ответ дан без вызова инструментов.

**B. Интерактивная сессия Claude Code CLI без подключения к IDE** (сессия `cd800b44…`, `entrypoint: "cli"`). В транскрипте
записано, что мост к IDE не подключился: `failedMcpServers: [{"name":"ide","error":"WebSocket is not open…"}]`.
Это дополнительные материалы, вызовами из IDE они не считаются:
- 7 вызовов `dev-helper` со скриншотами 00–06, включая те же сценарии `run_check test` и `PATH_OUTSIDE_ROOT`;
- контрольный запрос «Чем stdio-транспорт MCP отличается от HTTP?»: `dev-helper` не вызывался, агент обратился к другому MCP-серверу (context7);
- **запрос без подсказки** (строка 1a): «Где в демо-проекте используется функция applyDiscount?» — агент **не** вызвал MCP и выполнил `grep` через Bash.

**C. Неинтерактивная CLI-трасса** (`claude -p` с той же конфигурацией, из `demo-project/`, модель haiku): один вызов
`search_code`, success. Подтверждает запуск сервера из подкаталога. Это дополнение, а не демонстрация в IDE.

## 9. Доказательства

| Файл | Что содержит |
|---|---|
| [`evidence/requests.md`](evidence/requests.md) | таблицы запросов по сессиям: ожидаемый и фактический инструмент, результат, ссылки, статус |
| [`evidence/traces/vscode-session-5306ccc9.jsonl`](evidence/traces/vscode-session-5306ccc9.jsonl), [`evidence/server-log/vscode-session-5306ccc9.jsonl`](evidence/server-log/vscode-session-5306ccc9.jsonl) | IDE, сессия A1 (`claude-vscode`): запросы I1–I4, 4 вызова, 4 записи лога |
| [`evidence/screenshots/ide-01.png`](evidence/screenshots/ide-01.png) | панель расширения Claude Code в VS Code, сессия A1: запросы I3–I4 и вызов `Dev-helper [run_check]` (`typecheck`) |
| [`02-ide-run_check.png`](evidence/screenshots/02-ide-run_check.png), [`03-ide-get_file_outline.png`](evidence/screenshots/03-ide-get_file_outline.png), [`04-ide-no_tool.png`](evidence/screenshots/04-ide-no_tool.png) | панель расширения в VS Code, сессия A2: I5 (`Dev-helper [run_check]`, 8 тестов `ok`), I6 (`PATH_OUTSIDE_ROOT` и повтор с `NOT_FOUND`), I7 (ответ без инструментов) |
| [`evidence/traces/vscode-session-447d7630.jsonl`](evidence/traces/vscode-session-447d7630.jsonl), [`evidence/server-log/vscode-session-447d7630.jsonl`](evidence/server-log/vscode-session-447d7630.jsonl) | IDE, сессия A2 (`claude-vscode`): запросы I5–I7, 3 вызова, 3 записи лога |
| [`evidence/traces/claude-session-cd800b44.jsonl`](evidence/traces/claude-session-cd800b44.jsonl), [`evidence/server-log/claude-session-cd800b44.jsonl`](evidence/server-log/claude-session-cd800b44.jsonl) | CLI-сессия B: 7 вызовов и 7 записей лога; поле `ideBridge` фиксирует, что мост к IDE не подключился |
| [`evidence/screenshots/00-mcp-status.png`](evidence/screenshots/00-mcp-status.png) … [`06-no-tool.png`](evidence/screenshots/06-no-tool.png) | скриншоты CLI-сессии B: `/mcp` (`✔ dev-helper`, 4 tools) и запросы 1–6 |
| [`evidence/traces/cli-01-search_code.jsonl`](evidence/traces/cli-01-search_code.jsonl), [`evidence/server-log/cli-01-search_code.jsonl`](evidence/server-log/cli-01-search_code.jsonl) | неинтерактивная CLI-трасса C (`claude -p`) |

Трассы — выжимки из настоящих транскриптов Claude Code, сделанные скриптом [`scripts/collect-evidence.ts`](scripts/collect-evidence.ts).
Скрипт копирует только сведения о сессии (включая `entrypoint`), запросы, вызовы и результаты `dev-helper`, ответы агента,
а также записи лога сервера за то же время. Каждому из 15 `tool_use` во всех трассах соответствует запись `tool_call`
в серверном логе с тем же инструментом и параметрами. Запись появляется через 0,08–0,61 с после `tool_use`; исключение —
запрос 5 CLI-сессии B (3,84 с), причина задержки в трассе не зафиксирована.

Трассы и логи подтверждают **факт** вызовов, автоматические тесты (раздел 7) — **корректность** поведения.
Сессии B и C — вызовы из CLI, они не выдаются за вызовы из IDE.

## 10. Соответствие заданию, ограничения и выводы

### Сверка с критериями из исходного задания

Исходное задание хранится в `task.md`; по решению автора файл не коммитится.

| Критерий | Статус | Где подтверждено |
|---|---|---|
| Сервер запускается по инструкции из репозитория | выполнено | [`README.md`](README.md#установка-сборка-проверка), раздел 7 |
| Минимум 2 инструмента (лучше 3–4) с описаниями и параметрами | выполнено, 4 | раздел 3, [`src/contracts.ts:L158–L195`](src/contracts.ts#L158-L195) |
| Структурированный результат, а не текст | выполнено | `outputSchema` + `structuredContent`, раздел 4 |
| Интеграция с агентом в IDE показана и воспроизводима | выполнено | [`.mcp.json`](.mcp.json), README, сессии A1–A2 (`claude-vscode`) |
| ≥ 5 проверочных запросов, ≥ 3 вызывают MCP-tool | выполнено | в IDE 7 запросов (I1–I7): 6 вызвали инструменты `dev-helper`, все 4 инструмента задействованы; I7 — контрольный без вызова |
| Фиксация запроса, ожидаемого tool и подтверждения | выполнено | [`evidence/requests.md`](evidence/requests.md) |
| Логи на стороне сервера (tool, параметры, статус) | выполнено | раздел 5, примеры в разделе 8 |
| Секреты не закоммичены, есть `.env.example` | выполнено | раздел 5 |
| Описание подключения IDE к MCP и что такое tool | выполнено | раздел 1 |
| Ссылки на код с диапазонами строк (сервер, tools, логи, пример вывода, контракты) | выполнено | разделы 2–5, 8 |

### Ограничения реализации

- `lookup_docs` сводит слова к основе простым отсечением до 5 символов. Это детерминированно, но возможны ложные совпадения.
- `get_file_outline` работает только по AST, без вывода типов: например, у `static readonly maxQuantity` тип не показан.
- `run_check typecheck` проверяет только `demo-project/src`: тестам демо-проекта нужен `@types/node`, а своих зависимостей у демо-проекта нет.
- `O_NOFOLLOW` защищает последний компонент пути. Подмену промежуточного каталога между проверкой и открытием ловит сверка inode, но это не атомарная гарантия.
- Остановка группы процессов по таймауту и тесты с симлинками рассчитаны на macOS и Linux.
- У записей лога об отказах SDK (`stage: "sdk_validation"`) нет `callId`.

### Наблюдения по демонстрации

- **Без явной подсказки агент может не выбрать MCP-инструмент.** В CLI-сессии на запрос 1a агент ответил через `grep` в Bash. Во всех запросах из IDE, которые вызвали инструменты (I1–I6), была подсказка «Используй dev-helper». Поведение без подсказки в IDE проверено только на контрольном вопросе I7, где инструмент и не нужен.
- **Агент сам повторяет вызов после ошибки.** После отказа `PATH_OUTSIDE_ROOT` в I6 агент вызвал `get_file_outline` для `src/server.ts` внутри демо-проекта и получил `NOT_FOUND`. Он сообщил пользователю обе ошибки, обойти ограничение не пытался.
- **Инструкция учитывает это поведение.** Контрольный запрос в [README (шаг 5)](README.md#подключение-к-claude-code) содержит явное «Используй dev-helper: …» и предупреждает, что без него агент может ответить встроенным поиском, как в запросе 1a.
- **Скриншоты из IDE** есть для I3–I7. Запросы I1–I2 подтверждены трассой и серверным логом без скриншотов.
- В контрольном запросе CLI-сессии B агент обратился к другому подключённому MCP-серверу (context7). В IDE-запросе I7 инструменты не вызывались вовсе.

### Вывод

MCP-сервер `dev-helper` реализован на официальном TypeScript SDK со stdio-транспортом и четырьмя инструментами со
строгими контрактами, песочницей и структурированными логами. Корректность поведения покрыта 58 автоматическими тестами.
Подключение к Claude Code воспроизводимо через `.mcp.json`. Из чата расширения Claude Code в VS Code выполнено
7 проверочных запросов: 6 привели к реальным вызовам всех четырёх инструментов, включая запуск тестов через `run_check`
и отказ песочницы `PATH_OUTSIDE_ROOT`, а контрольный запрос прошёл без вызова. Каждый вызов подтверждён трассой
сессии и серверным логом, запросы I3–I7 — ещё и скриншотами. CLI-сессии приведены как дополнительные материалы.
