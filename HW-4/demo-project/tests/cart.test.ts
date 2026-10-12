import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cart, calculateTotal } from '../src/cart.ts';
import { applyDiscount } from '../src/discounts.ts';
import { isCartError } from '../src/errors.ts';

const book = { sku: 'BOOK-1', name: 'Book', unitPrice: 499.99, quantity: 2 };
const pen = { sku: 'PEN-1', name: 'Pen', unitPrice: 0.1, quantity: 3 };

test('total sums items without floating point drift', () => {
    assert.equal(calculateTotal([book, pen]), 1000.28);
});

test('percent discount is applied to the subtotal and rounded', () => {
    assert.equal(applyDiscount(1000.28, { kind: 'percent', value: 15 }), 850.24);
});

test('fixed discount never makes the total negative', () => {
    assert.equal(calculateTotal([pen], { kind: 'fixed', value: 5 }), 0);
});

test('percent discount above the limit is rejected', () => {
    assert.throws(() => applyDiscount(100, { kind: 'percent', value: 60 }), error => isCartError(error) && error.code === 'INVALID_DISCOUNT');
});

test('cart merges quantities and enforces the per-item limit', () => {
    const cart = new Cart();
    cart.addItem(book);
    cart.addItem({ ...book, quantity: 1 });
    assert.equal(cart.items[0]?.quantity, 3);
    assert.throws(() => cart.addItem({ ...book, quantity: 97 }), error => isCartError(error) && error.code === 'INVALID_QUANTITY');
});

test('removing a missing item throws ITEM_NOT_FOUND', () => {
    assert.throws(() => new Cart().removeItem('NOPE'), error => isCartError(error) && error.code === 'ITEM_NOT_FOUND');
});
