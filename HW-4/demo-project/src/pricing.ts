import { CartError } from './errors.ts';

/** Currency used by the shop. */
export const CURRENCY = 'RUB';

/** Converts an amount in rubles to integer kopecks, rounding half up. */
export function toKopecks(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
        throw new CartError('INVALID_PRICE', `Price must be a non-negative finite number, got ${amount}`);
    }
    // Number.EPSILON compensates binary representation errors such as 1.005 * 100 = 100.49999.
    return Math.round((amount + Number.EPSILON) * 100);
}

/** Rounds a price to whole kopecks, half up (see docs-kb/pricing-rounding.md). */
export function roundPrice(amount: number): number {
    return toKopecks(amount) / 100;
}

/** Formats a price for display, e.g. 1234.5 -> "1 234,50 ₽". */
export function formatPrice(amount: number): string {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: CURRENCY }).format(roundPrice(amount));
}
