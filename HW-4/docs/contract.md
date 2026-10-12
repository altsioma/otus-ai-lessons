# Контракты инструментов dev-helper

Источник истины — Zod-схемы в [`src/contracts.ts`](../src/contracts.ts). SDK строит из них JSON Schema для `tools/list`
(`inputSchema` и `outputSchema`), проверяет входные параметры до вызова обработчика и проверяет `structuredContent`
успешного результата по `outputSchema`. Тест `tests/contracts.test.ts` сверяет этот документ со схемами:
все поля и коды ошибок, перечисленные в схемах, должны быть описаны здесь.

Все объекты строгие (`additionalProperties: false`): лишние поля во входных параметрах отклоняются.
Пути возвращаются относительно корня (демо-проекта или `docs-kb/`) с разделителем `/`.

## Формат результата

| Исход | `isError` | `structuredContent` | `content` |
|---|---|---|---|
| Успех | нет | объект по `outputSchema` инструмента | `[{ type: "text", text: JSON.stringify(structuredContent) }]` |
| Ошибка инструмента | `true` | `{ error: { code, message } }` | `[{ type: "text", text: JSON.stringify(structuredContent) }]` |
| Невалидные параметры (отклоняет SDK) | `true` | отсутствует | `[{ type: "text", text: "Input validation error: …" }]` |

`message` — человекочитаемое описание; в нём бывает только путь, переданный вызывающим, и никогда содержимое файлов.

## Коды ошибок

| `code` | Когда |
|---|---|
| `INVALID_INPUT` | параметры прошли схему, но непригодны (путь с NUL-байтом, тема без значимых слов) |
| `PATH_OUTSIDE_ROOT` | абсолютный путь, выход через `../` или симлинк, ведущий за пределы корня |
| `ACCESS_DENIED` | путь из запрещённого списка (`.env`, `.git`, `node_modules`, ключи…), подмена файла при открытии |
| `NOT_FOUND` | файл или каталог не существует |
| `NOT_A_FILE` | ожидался обычный файл, а это каталог или спецфайл |
| `FILE_TOO_LARGE` | файл больше 256 KB |
| `UNSUPPORTED_FILE_TYPE` | не TypeScript-файл для `get_file_outline` или бинарный файл |
| `CHECK_NOT_ALLOWED` | проверка не из разрешённого списка `run_check` |
| `TIMEOUT` | проверка не уложилась в `CHECK_TIMEOUT_MS` и была остановлена |
| `EXECUTION_FAILED` | процесс проверки не удалось запустить или он убит сигналом |
| `INTERNAL_ERROR` | непредвиденная ошибка (подробности только в локальном логе) |

## `search_code`

Поиск буквального текста (не регулярного выражения) в файлах демо-проекта. Одно совпадение на строку, файлы в порядке путей.

**Вход**

| Поле | Тип | По умолчанию | Ограничения |
|---|---|---|---|
| `query` | string | — | 1–200 символов |
| `path` | string | `"."` | 1–300 символов, относительный путь к каталогу или файлу |
| `extensions` | string[] | `.ts .tsx .js .mjs .json .md` | 1–10 элементов вида `.ts` |
| `caseSensitive` | boolean | `false` | |
| `maxResults` | integer | `20` | 1–100 |

**Выход**

| Поле | Тип | Описание |
|---|---|---|
| `query` | string | запрос |
| `path` | string | где искали |
| `matches[]` | object[] | `file`, `line` (≥1), `column` (≥1), `text` (строка, обрезана до 200 символов) |
| `totalMatches` | integer | всего совпавших строк в просмотренных файлах |
| `filesScanned` | integer | прочитано файлов |
| `filesSkipped` | integer | пропущено (больше 256 KB или бинарные) |
| `truncated` | boolean | `matches` обрезаны до `maxResults` или достигнут лимит 2000 файлов |

Пустой результат — успех с `matches: []`.

## `get_file_outline`

Публичные экспорты TypeScript-файла по AST TypeScript Compiler API (без проверки типов).

**Вход**

| Поле | Тип | Ограничения |
|---|---|---|
| `path` | string | 1–300 символов, `.ts`, `.tsx`, `.mts` или `.cts` |

**Выход**

| Поле | Тип | Описание |
|---|---|---|
| `file` | string | путь к файлу |
| `exports[]` | object[] | см. ниже |
| `totalExports` | integer | число экспортов |

Элемент `exports[]`:

| Поле | Тип | Описание |
|---|---|---|
| `name` | string | экспортируемое имя; `default` для экспорта по умолчанию, `*` для `export *` |
| `kind` | enum | `function`, `class`, `interface`, `type`, `enum`, `variable`, `namespace`, `re-export`, `default` |
| `line` | integer | строка объявления (или `export { … }`) |
| `signature` | string | объявление без тела и без `export`, до 300 символов |
| `isDefault` | boolean | экспорт по умолчанию |
| `jsDoc` | string \| null | текст JSDoc-комментария |
| `members[]` | object[] | публичные члены класса или интерфейса: `name`, `kind` (`constructor`, `method`, `property`, `getter`, `setter`), `line`, `signature`, `isStatic`; для остальных — `[]` |

## `lookup_docs`

Детерминированный поиск по разделам Markdown в `docs-kb/`. Слова темы приводятся к нижнему регистру, стоп-слова
отбрасываются, остальные сокращаются до префикса («основы»), чтобы совпадали формы слова. Очки: +3 за основу в
заголовке (включая родительские), +1 за каждое вхождение в тексте раздела, но не больше 3 на основу.

**Вход**

| Поле | Тип | По умолчанию | Ограничения |
|---|---|---|---|
| `topic` | string | — | 2–200 символов |
| `maxSections` | integer | `3` | 1–5 |

**Выход**

| Поле | Тип | Описание |
|---|---|---|
| `topic` | string | запрос |
| `terms` | string[] | основы слов, по которым шёл поиск |
| `results[]` | object[] | `source` (файл в `docs-kb/`), `heading`, `headingPath` (`Родитель > Раздел`), `lineStart`, `lineEnd`, `excerpt` (до 600 символов), `score` (≥1) |
| `documentsSearched` | integer | просмотрено документов |
| `sectionsSearched` | integer | просмотрено разделов |

Нет совпадений — успех с `results: []`.

## `run_check`

Запуск одной разрешённой проверки демо-проекта. Команды фиксированы в коде, аргументы от вызывающего не принимаются.

**Вход**

| Поле | Тип | Ограничения |
|---|---|---|
| `check` | enum | `test` или `typecheck` |

| `check` | Фактическая команда (cwd = демо-проект) |
|---|---|
| `test` | `node --test --test-reporter=tap 'tests/**/*.test.ts'` |
| `typecheck` | `tsc --noEmit --pretty false -p tsconfig.json` |

**Выход**

| Поле | Тип | Описание |
|---|---|---|
| `check` | enum | какая проверка запускалась |
| `command` | string | команда для отображения |
| `exitCode` | integer | код завершения |
| `passed` | boolean | `exitCode === 0` |
| `durationMs` | integer | длительность |
| `summary` | object | `testsPassed`, `testsFailed` (для `test`), `typeErrors` (для `typecheck`); неприменимые поля — `null` |
| `output` | string | хвост объединённого stdout/stderr, до 4000 символов |
| `outputTruncated` | boolean | вывод был обрезан |

Непрошедшие тесты — это успешный вызов с `passed: false`. Ошибкой (`TIMEOUT`, `EXECUTION_FAILED`) считается только
невозможность получить результат проверки.
