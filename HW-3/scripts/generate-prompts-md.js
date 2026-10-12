// Генерирует prompts.md из исходников промптов (src/prompts/*.js).
import { writeFileSync } from 'node:fs';
import { renderPromptsMarkdown } from '../src/prompts/prompts-markdown.js';

const target = new URL('../prompts.md', import.meta.url);
writeFileSync(target, renderPromptsMarkdown());
console.log('prompts.md обновлён из src/prompts/*.js');
