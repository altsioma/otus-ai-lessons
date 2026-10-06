// Проверяет синтаксис всех JS-файлов проекта через `node --check`.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', 'coverage', '.git']);

function collectJsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRS.has(entry.name) ? [] : collectJsFiles(path);
    }
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

const files = collectJsFiles('.').sort();
const failed = files.filter((file) => {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  return result.status !== 0;
});

if (failed.length > 0) {
  console.error(`Синтаксические ошибки в ${failed.length} из ${files.length} файлов: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`Синтаксис в порядке: ${files.length} файлов (${files.join(', ')})`);
