> ⚠️ **ДЕМОНСТРАЦИОННЫЙ ПРИМЕР ФОРМАТА — НЕ ФАКТИЧЕСКИЙ РЕЗУЛЬТАТ.**
> Все значения в угловых скобках (`<...>`) — placeholders. Live evaluation ещё не выполнялась.
> Фактический отчёт создаётся командой `npm run eval:agent` в файле `docs/evaluation-results.md`.

# Результаты проверки агента

| Параметр | Значение |
|---|---|
| Начало запуска (UTC) | `<дата и время>` |
| Окончание запуска (UTC) | `<дата и время>` |
| Модель (`OLLAMA_MODEL`) | `<модель>` |
| Ollama | `<OLLAMA_BASE_URL>`, версия `<версия>` |
| Node.js | `<версия>` |
| Пакеты | `langchain` `<версия>`, `@langchain/ollama` `<версия>` |
| API | временный локальный Express API на `http://127.0.0.1:<порт>`, запущен runner'ом на время проверки |
| Итог | `<N> из 5 сценариев PASS` |

## Сводка

| # | Запрос | Ожидаемое действие | Фактическое действие | Ожидаемый HTTP-вызов | Фактический вызов | Результат |
|---|---|---|---|---|---|---|
| 1 | создай задачу Подготовить итоговый отчёт | create_task (success) | `<action (status)>` | POST /tasks | `<METHOD path → HTTP>` | `<PASS/FAIL>` |
| 2 | покажи задачу `<ID_FROM_CREATE>` | get_task (success) | `<action (status)>` | GET /tasks/:id | `<METHOD path → HTTP>` | `<PASS/FAIL>` |
| 3 | отметь задачу `<ID_FROM_CREATE>` как выполненную | update_task_status (success) | `<action (status)>` | PATCH /tasks/:id/status | `<METHOD path → HTTP>` | `<PASS/FAIL>` |
| 4 | покажи статистику задач | get_task_stats (success) | `<action (status)>` | GET /tasks/stats | `<METHOD path → HTTP>` | `<PASS/FAIL>` |
| 5 | удали все задачи | none (error) | `<action (status)>` | без вызова tools | `<нет вызовов>` | `<PASS/FAIL>` |

## Подробности

Для каждого сценария фактический отчёт содержит:

- точный запрос;
- причины FAIL (если есть);
- полный JSON-ответ агента;
- строки `[tool:...]` из отладочного лога tools (для сценариев 1–4);
- для сценария 5 — подтверждение, что ни один task tool не вызван.
