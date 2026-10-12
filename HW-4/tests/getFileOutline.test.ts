import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { getFileOutlineOutput } from '../src/contracts.ts';
import { ToolError } from '../src/errors.ts';
import { getFileOutline } from '../src/tools/getFileOutline.ts';
import { demoContext, hostileFixture } from './helpers.ts';

const ctx = demoContext();
const fails = (code: string) => (error: unknown) => error instanceof ToolError && error.code === code;

describe('get_file_outline', () => {
    test('lists exports of src/cart.ts with kinds, lines, signatures and members', async () => {
        const result = getFileOutlineOutput.parse(await getFileOutline({ path: 'src/cart.ts' }, ctx));
        assert.equal(result.file, 'src/cart.ts');
        assert.deepEqual(result.exports.map(item => [item.name, item.kind]), [
            ['MAX_QUANTITY_PER_ITEM', 'variable'],
            ['CartItem', 'interface'],
            ['calculateSubtotal', 'function'],
            ['calculateTotal', 'function'],
            ['Cart', 'class']
        ]);
        const total = result.exports.find(item => item.name === 'calculateTotal')!;
        assert.equal(total.signature, 'function calculateTotal(items: readonly CartItem[], discount?: Discount): number');
        assert.equal(total.line, 23);
        assert.match(total.jsDoc ?? '', /optional discount/);

        const cart = result.exports.find(item => item.name === 'Cart')!;
        assert.equal(cart.signature, 'class Cart');
        const memberNames = cart.members.map(member => member.name);
        assert.deepEqual(memberNames, ['maxQuantity', 'addItem', 'removeItem', 'setDiscount', 'items', 'total']);
        assert.ok(!memberNames.some(name => name.startsWith('#')), 'private fields are not public API');
        assert.equal(cart.members.find(member => member.name === 'maxQuantity')?.isStatic, true);
        assert.equal(cart.members.find(member => member.name === 'items')?.kind, 'getter');
    });

    test('handles type aliases, unions and constants', async () => {
        const result = await getFileOutline({ path: 'src/discounts.ts' }, ctx);
        const discount = result.exports.find(item => item.name === 'Discount')!;
        assert.equal(discount.kind, 'type');
        assert.match(discount.signature, /kind: 'percent'/);
        assert.equal(result.exports.find(item => item.name === 'MAX_PERCENT_DISCOUNT')?.signature, 'const MAX_PERCENT_DISCOUNT = 50');
    });

    test('rejects non-TypeScript, missing and outside files', async () => {
        await assert.rejects(getFileOutline({ path: 'package.json' }, ctx), fails('UNSUPPORTED_FILE_TYPE'));
        await assert.rejects(getFileOutline({ path: 'src/missing.ts' }, ctx), fails('NOT_FOUND'));
        await assert.rejects(getFileOutline({ path: '../src/server.ts' }, ctx), fails('PATH_OUTSIDE_ROOT'));
    });
});

describe('get_file_outline on edge cases', () => {
    const fx = hostileFixture();
    after(fx.cleanup);

    test('covers default, re-export, local export lists and arrow functions', async () => {
        writeFileSync(
            path.join(fx.root, 'src/edge.ts'),
            [
                "export * from './app.ts';",
                "export { greet as hello } from './app.ts';",
                'const helper = (a: number, b = 2): number => a + b;',
                'enum Color { Red, Green }',
                'export { helper, Color as Palette };',
                '/** Main entry. */',
                'export default function main(): void {}'
            ].join('\n')
        );
        const result = await getFileOutline({ path: 'src/edge.ts' }, fx.ctx);
        assert.deepEqual(result.exports.map(item => [item.name, item.kind, item.isDefault]), [
            ['*', 're-export', false],
            ['hello', 're-export', false],
            ['helper', 'function', false],
            ['Palette', 'enum', false],
            ['default', 'function', true]
        ]);
        assert.equal(result.exports[2]!.signature, 'const helper = (a: number, b = 2): number => …');
        assert.equal(result.exports[4]!.jsDoc, 'Main entry.');
    });

    test('refuses symlinks leaving the root and denied files', async () => {
        await assert.rejects(getFileOutline({ path: 'src/link-out.ts' }, fx.ctx), fails('PATH_OUTSIDE_ROOT'));
        await assert.rejects(getFileOutline({ path: 'src/env-link.ts' }, fx.ctx), fails('ACCESS_DENIED'));
        await assert.rejects(getFileOutline({ path: 'src/big.ts' }, fx.ctx), fails('FILE_TOO_LARGE'));
    });
});
