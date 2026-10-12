import { readFileSync } from 'node:fs';

/** Версии пакетов из node_modules (без загрузки самих пакетов). */
export function readPackageVersions(names = ['langchain', '@langchain/ollama'], root = new URL('../../', import.meta.url)) {
  return Object.fromEntries(
    names.map((name) => {
      try {
        return [name, JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, root), 'utf8')).version];
      } catch {
        return [name, 'неизвестно'];
      }
    }),
  );
}

const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function actualCalls(scenario) {
  return scenario.trace.length > 0 ? scenario.trace.map((call) => `${call.method} ${call.path} → ${call.httpStatus ?? 'n/a'}`).join('<br>') : 'нет вызовов';
}

/**
 * Markdown-отчёт по фактическому прогону runEvaluation().
 *
 * @param {Awaited<ReturnType<import('./run-evaluation.js').runEvaluation>>} report
 * @param {{ nodeVersion?: string, packageVersions?: Record<string, string> }} [meta]
 */
export function renderEvaluationMarkdown(report, { nodeVersion = process.version, packageVersions = readPackageVersions() } = {}) {
  const rows = report.scenarios
    .map((s) =>
      [
        s.number,
        cell(s.request ?? '(не отправлен)'),
        cell(`${s.expectedAction} (${s.expectedStatus})`),
        cell(s.result ? `${s.result.action} (${s.result.status})` : '—'),
        cell(s.expectedCalls.length > 0 ? s.expectedCalls.join(', ') : 'без вызова tools'),
        actualCalls(s),
        s.passed ? '**PASS**' : '**FAIL**',
      ].join(' | '),
    )
    .map((row) => `| ${row} |`)
    .join('\n');

  const details = report.scenarios
    .map((s) => {
      const parts = [`### ${s.number}. ${s.title} — ${s.passed ? 'PASS' : 'FAIL'}`, '', `Запрос: \`${s.request ?? '(не отправлен)'}\``, ''];
      if (!s.passed) {
        parts.push('Причины FAIL:', '', ...s.reasons.map((reason) => `- ${reason}`), '');
      }
      parts.push('Ответ агента:', '', '```json', JSON.stringify(s.result, null, 2), '```', '');
      if (s.expectedCalls.length === 0) {
        parts.push(
          s.trace.length === 0
            ? 'Trace tools: **ни один task tool не вызван** (строк `[tool:...]` нет).'
            : 'Trace tools: **вызваны tools, хотя не должны были**:',
          '',
        );
      } else {
        parts.push('Trace tools:', '');
      }
      if (s.traceLines.length > 0) {
        parts.push('```text', ...s.traceLines, '```', '');
      } else if (s.expectedCalls.length > 0) {
        parts.push('_Строк `[tool:...]` нет._', '');
      }
      return parts.join('\n');
    })
    .join('\n');

  const versions = Object.entries(packageVersions)
    .map(([name, version]) => `\`${name}\` ${version}`)
    .join(', ');

  return `# Результаты проверки агента

Отчёт сгенерирован командой \`npm run eval:agent\` по фактическому запуску с локальной моделью Ollama (\`ChatOllama\`). Токены и API key не использовались.

| Параметр | Значение |
|---|---|
| Начало запуска (UTC) | ${report.startedAt} |
| Окончание запуска (UTC) | ${report.finishedAt} |
| Модель (\`OLLAMA_MODEL\`) | \`${report.model}\` |
| Ollama | \`${report.ollama?.baseUrl ?? '—'}\`, версия ${report.ollama?.version ?? 'неизвестна'} |
| Node.js | ${nodeVersion} |
| Пакеты | ${versions} |
| API | временный локальный Express API (\`createApp()\`) на \`${report.apiBaseUrl}\` с новым in-memory хранилищем; запущен runner'ом на время проверки и остановлен после неё |
| Итог | **${report.passed} из ${report.total} сценариев PASS** |

## Сводка

| # | Запрос | Ожидаемое действие | Фактическое действие | Ожидаемый HTTP-вызов | Фактический вызов | Результат |
|---|---|---|---|---|---|---|
${rows}

ID задачи для сценариев 2 и 3 взят из фактического \`data.id\` ответа сценария 1.

## Подробности

${details}`;
}
