/** Error codes of the cart domain. See docs-kb/error-handling.md. */
export type CartErrorCode = 'INVALID_PRICE' | 'INVALID_QUANTITY' | 'ITEM_NOT_FOUND' | 'INVALID_DISCOUNT';

/** The only error type thrown by the cart module. */
export class CartError extends Error {
    readonly code: CartErrorCode;

    constructor(code: CartErrorCode, message: string) {
        super(message);
        this.name = 'CartError';
        this.code = code;
    }
}

/** Type guard for code that catches unknown errors. */
export function isCartError(error: unknown): error is CartError {
    return error instanceof CartError;
}
