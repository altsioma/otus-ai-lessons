import { CartError } from './errors.ts';
import { roundPrice } from './pricing.ts';

/** Maximum percent discount allowed for one cart. */
export const MAX_PERCENT_DISCOUNT = 50;

/** A cart-level discount: a percentage of the subtotal or a fixed amount in rubles. */
export type Discount = { kind: 'percent'; value: number } | { kind: 'fixed'; value: number };

/** Throws CartError INVALID_DISCOUNT if the discount breaks the rules in docs-kb/discounts.md. */
export function validateDiscount(discount: Discount): void {
    if (!Number.isFinite(discount.value) || discount.value <= 0) {
        throw new CartError('INVALID_DISCOUNT', 'Discount value must be a positive number');
    }
    if (discount.kind === 'percent' && discount.value > MAX_PERCENT_DISCOUNT) {
        throw new CartError('INVALID_DISCOUNT', `Percent discount cannot exceed ${MAX_PERCENT_DISCOUNT}%`);
    }
}

/** Applies a discount to a subtotal; the result is rounded and never negative. */
export function applyDiscount(subtotal: number, discount: Discount): number {
    validateDiscount(discount);
    const reduction = discount.kind === 'percent' ? (subtotal * discount.value) / 100 : discount.value;
    return roundPrice(Math.max(0, subtotal - reduction));
}
