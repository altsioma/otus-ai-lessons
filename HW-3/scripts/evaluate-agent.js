// Live-проверка агента: пять запросов к локальной модели Ollama против временного локального API.
// Токены и API key не нужны. Перед запуском проверяется, что Ollama доступен и модель установлена;
// модель автоматически не скачивается. Отчёт: docs/evaluation-results.md.
import { writeFileSync } from 'node:fs';
import { ConfigError, loadConfig } from '../src/config.js';
import { OllamaError } from '../src/agent/ollama.js';
import { runEvaluation } from '../src/evaluation/run-evaluation.js';
import { renderEvaluationMarkdown } from '../src/evaluation/render-report.js';

const REPORT = new URL('../docs/evaluation-results.md', import.meta.url);

function abort(message) {
  console.error(`Live evaluation не запущена: ${message}`);
  process.exit(3);
}

let config;
try {
  config = loadConfig();
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  abort(error.message);
}

const stderrLine = (line) => process.stderr.write(`${line}\n`);

console.log(`Live evaluation: Ollama ${config.ollama.baseUrl}, модель ${config.ollama.model}, 5 сценариев.`);
let report;
try {
  report = await runEvaluation({
    config,
    echo: stderrLine,
    logger: { error: stderrLine, warn: stderrLine, debug: () => {} },
  });
} catch (error) {
  // Preflight не прошёл: отчёт не пишется, сценарии не выполнялись.
  if (!(error instanceof OllamaError)) throw error;
  abort(error.message);
}

writeFileSync(REPORT, renderEvaluationMarkdown(report));

for (const s of report.scenarios) {
  const verdict = s.passed ? 'PASS' : `FAIL — ${s.reasons.join('; ')}`;
  console.log(`${s.number}. ${s.request ?? '(не отправлен)'} → ${s.result?.action ?? '—'}/${s.result?.status ?? '—'}: ${verdict}`);
}
console.log(`Итог: ${report.passed}/${report.total} PASS. Отчёт: docs/evaluation-results.md`);
process.exitCode = report.passed === report.total ? 0 : 1;
