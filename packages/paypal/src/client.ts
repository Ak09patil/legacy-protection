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

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

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

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | null,
    readonly issue: string | null,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export class ProductionEndpointError extends Error {
  constructor(url: string) {
    super(`Refusing to use non-sandbox PayPal endpoint: ${url}`);
    this.name = "ProductionEndpointError";
  }
}

/** INV-19 */
export function assertSandbox(baseUrl: string): void {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    throw new ProductionEndpointError(baseUrl);
  }
  if (host !== "api-m.sandbox.paypal.com" && host !== "api.sandbox.paypal.com") {
    throw new ProductionEndpointError(baseUrl);
  }
}

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

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class PayPalClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenInFlight: Promise<string> | null = null;

  constructor(private readonly opts: PayPalClientOptions) {
    this.baseUrl = opts.baseUrl ?? SANDBOX_BASE_URL;
    assertSandbox(this.baseUrl); // INV-19
    if (!opts.clientId || !opts.clientSecret) throw new Error("PayPal client credentials are required");
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = opts.maxAttempts ?? 4;
  }

  /** Access token cached in memory per process (ADR-0006), refreshed before expiry. */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()) return this.token.value;
    if (this.tokenInFlight) return this.tokenInFlight;
    this.tokenInFlight = this.fetchToken().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw await toError(res, "Could not obtain a PayPal access token");
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token || typeof json.expires_in !== "number") {
      throw new PayPalError("Malformed token response", res.status, null, null);
    }
    this.token = { value: json.access_token, expiresAt: this.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async request<T>(req: PayPalRequest): Promise<T> {
    if (req.method !== "GET" && !req.idempotencyKey) {
      throw new Error("Mutating PayPal requests require an idempotency key (INV-03)");
    }
    const url = new URL(this.baseUrl + req.path);
    if (req.method === "GET" && req.query) {
      for (const [k, v] of Object.entries(req.query)) if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: "application/json",
        Prefer: "return=representation",
      };
      let body: string | undefined;
      if (req.method !== "GET") {
        headers["Content-Type"] = "application/json";
        headers["PayPal-Request-Id"] = req.idempotencyKey; // same key on every attempt
        body = req.body === undefined ? undefined : JSON.stringify(req.body);
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), { method: req.method, headers, ...(body ? { body } : {}) });
      } catch (e) {
        lastError = e;
        await this.backoff(attempt);
        continue;
      }

      if (res.status === 401 && attempt === 1) {
        this.token = null; // token revoked or expired early; refresh once
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = await toError(res, "PayPal temporarily unavailable");
        await this.backoff(attempt, res.headers.get("retry-after"));
        continue;
      }
      if (!res.ok) throw await toError(res, `PayPal ${req.method} ${req.path} failed`);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    throw lastError instanceof Error ? lastError : new Error("PayPal request failed");
  }

  private async backoff(attempt: number, retryAfter?: string | null): Promise<void> {
    if (attempt >= this.maxAttempts) return;
    const fromHeader = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const ms = Number.isFinite(fromHeader) ? fromHeader : Math.min(8000, 250 * 2 ** (attempt - 1));
    await this.sleep(ms);
  }
}

async function toError(res: Response, message: string): Promise<PayPalError> {
  let issue: string | null = null;
  try {
    const j = (await res.json()) as { name?: string; details?: { issue?: string }[] };
    issue = j.details?.[0]?.issue ?? j.name ?? null;
  } catch {
    // body not JSON; ignore
  }
  return new PayPalError(message, res.status, res.headers.get("paypal-debug-id"), issue);
}
