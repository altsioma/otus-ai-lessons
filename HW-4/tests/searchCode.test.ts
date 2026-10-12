import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { searchCodeInput, searchCodeOutput } from '../src/contracts.ts';
import { ToolError } from '../src/errors.ts';
import { searchCode } from '../src/tools/searchCode.ts';
import { demoContext, ENV_SECRET, hostileFixture, OUTSIDE_SECRET } from './helpers.ts';

const ctx = demoContext();
const run = (input: Record<string, unknown>, context = ctx) => searchCode(searchCodeInput.parse(input), context);

describe('search_code on the demo project', () => {
    test('finds definition and usages with file, line and column', async () => {
        const result = searchCodeOutput.parse(await run({ query: 'applyDiscount' }));
        assert.ok(result.totalMatches >= 3);
        assert.deepEqual(
            result.matches.find(match => match.file === 'src/discounts.ts'),
            { file: 'src/discounts.ts', line: 21, column: 17, text: 'export function applyDiscount(subtotal: number, discount: Discount): number {' }
        );
        assert.ok(result.matches.some(match => match.file === 'src/cart.ts'));
    });

    test('returns an empty result when nothing matches', async () => {
        const result = await run({ query: 'definitelyNotInTheProject' });
        assert.deepEqual(result.matches, []);
        assert.equal(result.totalMatches, 0);
        assert.equal(result.truncated, false);
    });

    test('honours caseSensitive, path, extensions and maxResults', async () => {
        assert.equal((await run({ query: 'APPLYDISCOUNT', caseSensitive: true })).totalMatches, 0);
        const onlySrc = await run({ query: 'applyDiscount', path: 'src' });
        assert.ok(onlySrc.matches.every(match => match.file.startsWith('src/')));
        const limited = await run({ query: 'applyDiscount', maxResults: 1 });
        assert.equal(limited.matches.length, 1);
        assert.equal(limited.truncated, true);
        assert.equal((await run({ query: 'applyDiscount', extensions: ['.md'] })).totalMatches, 0);
    });

    test('reports a missing path as NOT_FOUND', async () => {
        await assert.rejects(run({ query: 'x', path: 'src/missing' }), (error: unknown) => error instanceof ToolError && error.code === 'NOT_FOUND');
    });
});

describe('search_code security', () => {
    const fx = hostileFixture();
    after(fx.cleanup);

    test('never returns matches from denied files or outside symlinks', async () => {
        const result = await run({ query: 'needle', extensions: ['.ts', '.md', '.txt', '.pem'] }, fx.ctx);
        const files = new Set(result.matches.map(match => match.file));
        assert.deepEqual([...files].sort(), ['docs/guide.md', 'notes.txt', 'src/app.ts']);
        assert.equal(result.filesSkipped, 2, 'big.ts and binary.ts are skipped');
        assert.ok(!JSON.stringify(result).includes(ENV_SECRET));
        assert.ok(!JSON.stringify(await run({ query: 'leaked' }, fx.ctx)).includes(OUTSIDE_SECRET));
    });

    test('rejects traversal in path', async () => {
        await assert.rejects(run({ query: 'leaked', path: '../outside' }, fx.ctx), (error: unknown) => error instanceof ToolError && error.code === 'PATH_OUTSIDE_ROOT');
    });
});
