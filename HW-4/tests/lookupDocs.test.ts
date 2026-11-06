import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lookupDocsInput, lookupDocsOutput } from '../src/contracts.ts';
import { ToolError } from '../src/errors.ts';
import { lookupDocs, parseSections, terms } from '../src/tools/lookupDocs.ts';
import { demoContext } from './helpers.ts';

const ctx = demoContext();
const run = (input: Record<string, unknown>) => lookupDocs(lookupDocsInput.parse(input), ctx);

describe('lookup_docs', () => {
    test('finds the rounding rule for a Russian question', async () => {
        const result = lookupDocsOutput.parse(await run({ topic: 'Как округляются цены?' }));
        const top = result.results[0]!;
        assert.equal(top.source, 'pricing-rounding.md');
        assert.equal(top.heading, 'Правило округления');
        assert.equal(top.headingPath, 'Округление цен > Правило округления');
        assert.deepEqual([top.lineStart, top.lineEnd], [5, 11]);
        assert.match(top.excerpt, /половиной вверх/);
        assert.equal(result.documentsSearched, 4);
    });

    test('finds discount limits and respects maxSections', async () => {
        const result = await run({ topic: 'максимальная процентная скидка', maxSections: 1 });
        assert.equal(result.results.length, 1);
        assert.equal(result.results[0]!.source, 'discounts.md');
    });

    test('works for English identifiers in the docs', async () => {
        const result = await run({ topic: 'INVALID_DISCOUNT' });
        assert.ok(result.results.some(entry => entry.source === 'error-handling.md'));
    });

    test('returns an empty result when nothing matches', async () => {
        const result = await run({ topic: 'квантовая телепортация' });
        assert.deepEqual(result.results, []);
    });

    test('rejects a topic made of stop words only', async () => {
        await assert.rejects(run({ topic: 'как и что' }), (error: unknown) => error instanceof ToolError && error.code === 'INVALID_INPUT');
    });

    test('rejects invalid input by schema', () => {
        assert.equal(lookupDocsInput.safeParse({ topic: 'x' }).success, false);
        assert.equal(lookupDocsInput.safeParse({ topic: 'цены', maxSections: 10 }).success, false);
        assert.equal(lookupDocsInput.safeParse({ topic: 'цены', path: '../' }).success, false);
    });
});

describe('Markdown parsing', () => {
    test('computes heading paths and line ranges, ignoring headings in code fences', () => {
        const sections = parseSections('a.md', '# A\ntext\n## B\n```\n# not a heading\n```\n# C\n');
        assert.deepEqual(sections.map(s => [s.headingPath, s.lineStart, s.lineEnd]), [
            ['A', 1, 2],
            ['A > B', 3, 6],
            ['C', 7, 7]
        ]);
    });

    test('normalizes word forms to shared stems', () => {
        assert.deepEqual(terms('Округляются цены'), terms('округление цена'));
    });
});
