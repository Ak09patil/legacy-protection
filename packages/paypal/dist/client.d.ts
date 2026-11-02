/**
 * Minimal, typed PayPal REST client.
 *
 * INV-19: refuses any base URL other than the PayPal sandbox.
 * INV-03: every mutating request must carry an idempotency key, sent as
 *         PayPal-Request-Id. Retries reuse the same key, so PayPal returns the
 *         original result instead of acting twice.
 * INV-21: never logs credentials, tokens or response bodies.
 *
 * Only the executor worker constructs this client with a secret (INV-01).
 */
export declare const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export interface PayPalClientOptions {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly baseUrl?: string;
    readonly fetch?: FetchLike;
    readonly now?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly maxAttempts?: number;
}
export declare class PayPalError extends Error {
    readonly status: number;
    readonly debugId: string | null;
    readonly issue: string | null;
    constructor(message: string, status: number, debugId: string | null, issue: string | null);
}
export declare class ProductionEndpointError extends Error {
    constructor(url: string);
}
/** INV-19 */
export declare function assertSandbox(baseUrl: string): void;
type Method = "GET" | "POST" | "PATCH" | "DELETE";
interface ReadRequest {
    readonly method: "GET";
    readonly path: string;
    readonly query?: Record<string, string | number | undefined>;
}
interface WriteRequest {
    readonly method: Exclude<Method, "GET">;
    readonly path: string;
    readonly body?: unknown;
    /** Required for every mutating call. INV-03 */
    readonly idempotencyKey: string;
}
export type PayPalRequest = ReadRequest | WriteRequest;
export declare class PayPalClient {
    private readonly opts;
    private readonly baseUrl;
    private readonly fetchImpl;
    private readonly now;
    private readonly sleep;
    private readonly maxAttempts;
    private token;
    private tokenInFlight;
    constructor(opts: PayPalClientOptions);
    /** Access token cached in memory per process (ADR-0006), refreshed before expiry. */
    accessToken(): Promise<string>;
    private fetchToken;
    request<T>(req: PayPalRequest): Promise<T>;
    private backoff;
}
export {};
