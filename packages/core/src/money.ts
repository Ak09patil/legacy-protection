/**
 * Money is always an integer number of minor units (cents) plus an ISO-4217
 * currency code. Never a float. Arithmetic across currencies is an error.
 * INV-05
 */

export type Currency = string & { readonly __currency: unique symbol };

export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function currency(code: string): Currency {
  if (!CURRENCY_RE.test(code)) throw new Error(`Invalid currency code: ${code}`);
  return code as Currency;
}

export function money(minor: bigint | number, code: string): Money {
  const m = typeof minor === "number" ? toBigIntStrict(minor) : minor;
  return { minor: m, currency: currency(code) };
}

function toBigIntStrict(n: number): bigint {
  if (!Number.isSafeInteger(n)) throw new Error(`Money minor units must be a safe integer, got ${n}`);
  return BigInt(n);
}

/** Parse a decimal string like "12.34" into minor units. Rejects floats-in-disguise like "1e3". */
export function parseDecimal(value: string, code: string, exponent = 2): Money {
  const re = new RegExp(`^(-?)(\\d+)(?:\\.(\\d{1,${exponent}}))?$`);
  const m = re.exec(value);
  if (!m) throw new Error(`Invalid decimal amount: ${value}`);
  const [, sign, whole, frac = ""] = m;
  const minor = BigInt(whole! + frac.padEnd(exponent, "0"));
  return money(sign === "-" ? -minor : minor, code);
}

/** Format minor units as a decimal string, e.g. for PayPal API "value" fields. */
export function toDecimal(a: Money, exponent = 2): string {
  const neg = a.minor < 0n;
  const abs = (neg ? -a.minor : a.minor).toString().padStart(exponent + 1, "0");
  const whole = abs.slice(0, -exponent);
  const frac = abs.slice(-exponent);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sub(a: Money, b: Money): Money {
  assertSame(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSame(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export function sum(items: readonly Money[], code: string): Money {
  return items.reduce((acc, m) => add(acc, m), money(0n, code));
}
