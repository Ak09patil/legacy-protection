/**
 * Money is always an integer number of minor units (cents) plus an ISO-4217
 * currency code. Never a float. Arithmetic across currencies is an error.
 * INV-05
 */
export type Currency = string & {
    readonly __currency: unique symbol;
};
export interface Money {
    readonly minor: bigint;
    readonly currency: Currency;
}
export declare function currency(code: string): Currency;
export declare function money(minor: bigint | number, code: string): Money;
/** Parse a decimal string like "12.34" into minor units. Rejects floats-in-disguise like "1e3". */
export declare function parseDecimal(value: string, code: string, exponent?: number): Money;
/** Format minor units as a decimal string, e.g. for PayPal API "value" fields. */
export declare function toDecimal(a: Money, exponent?: number): string;
export declare function add(a: Money, b: Money): Money;
export declare function sub(a: Money, b: Money): Money;
export declare function compare(a: Money, b: Money): -1 | 0 | 1;
export declare function sum(items: readonly Money[], code: string): Money;
