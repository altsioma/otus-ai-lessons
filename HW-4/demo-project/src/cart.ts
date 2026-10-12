import { applyDiscount, type Discount } from './discounts.ts';
import { CartError } from './errors.ts';
import { roundPrice, toKopecks } from './pricing.ts';

/** Maximum quantity of one SKU in a cart. */
export const MAX_QUANTITY_PER_ITEM = 99;

export interface CartItem {
    sku: string;
    name: string;
    /** Price of one unit in rubles. */
    unitPrice: number;
    quantity: number;
}

/** Sum of line totals, computed in kopecks to avoid floating point drift. */
export function calculateSubtotal(items: readonly CartItem[]): number {
    const kopecks = items.reduce((sum, item) => sum + toKopecks(item.unitPrice) * item.quantity, 0);
    return kopecks / 100;
}

/** Subtotal with an optional discount applied (see docs-kb/discounts.md for the order of operations). */
export function calculateTotal(items: readonly CartItem[], discount?: Discount): number {
    const subtotal = calculateSubtotal(items);
    return discount ? applyDiscount(subtotal, discount) : roundPrice(subtotal);
}

/** In-memory shopping cart. */
export class Cart {
    static readonly maxQuantity = MAX_QUANTITY_PER_ITEM;

    #items = new Map<string, CartItem>();
    #discount: Discount | undefined;

    /** Adds units of an item; quantities of the same SKU are merged. */
    addItem(item: CartItem): void {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
            throw new CartError('INVALID_QUANTITY', `Quantity must be a positive integer, got ${item.quantity}`);
        }
        toKopecks(item.unitPrice); // validates the price
        const existing = this.#items.get(item.sku);
        const quantity = (existing?.quantity ?? 0) + item.quantity;
        if (quantity > MAX_QUANTITY_PER_ITEM) {
            throw new CartError('INVALID_QUANTITY', `At most ${MAX_QUANTITY_PER_ITEM} units of ${item.sku} are allowed`);
        }
        this.#items.set(item.sku, { ...item, quantity });
    }

    /** Removes an item completely. */
    removeItem(sku: string): void {
        if (!this.#items.delete(sku)) throw new CartError('ITEM_NOT_FOUND', `No item with SKU ${sku}`);
    }

    /** Sets the single cart-level discount, replacing the previous one. */
    setDiscount(discount: Discount | undefined): void {
        this.#discount = discount;
    }

    get items(): CartItem[] {
        return [...this.#items.values()];
    }

    /** Total to pay, rounded to kopecks. */
    total(): number {
        return calculateTotal(this.items, this.#discount);
    }
}
