import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CartError } from '../src/errors.ts';
import { roundPrice, toKopecks } from '../src/pricing.ts';

test('roundPrice rounds half up to kopecks', () => {
    assert.equal(roundPrice(1.005), 1.01);
    assert.equal(roundPrice(2.344), 2.34);
    assert.equal(roundPrice(10), 10);
});

test('toKopecks rejects negative and non-finite prices', () => {
    assert.throws(() => toKopecks(-1), CartError);
    assert.throws(() => toKopecks(Number.NaN), CartError);
});
