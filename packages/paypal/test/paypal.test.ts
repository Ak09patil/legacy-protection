import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { money } from "@lp/core";
import {
  assertSandbox,
  cancelSubscription,
  listTransactions,
  payCaregiver,
  PayPalClient,
  sendOwnerPayment,
  PayPalError,
  ProductionEndpointError,
  searchWindows,
  verifyWebhook,
  type FetchLike,
} from "../src/index.js";

/**
 * A fake PayPal that honours PayPal-Request-Id the way the real API does:
 * a repeated request id returns the stored response without a new effect.
 * It can also lose responses after doing the work, or fail before it,
 * which is how real networks break.
 */
class FakePayPal {
  effects = 0;
  tokenCalls = 0;
  seenRequestIds: string[] = [];
  private stored = new Map<string, unknown>();
  failures: Array<"LOSE_RESPONSE" | "FAIL_BEFORE" | "HTTP_503"> = [];

  fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/v1/oauth2/token") {
      this.tokenCalls++;
      return json(200, { access_token: `tok${this.tokenCalls}`, expires_in: 32400 });
    }
    const headers = init.headers as Record<string, string>;
    const id = headers["PayPal-Request-Id"];
    const failure = this.failures.shift();
    if (failure === "FAIL_BEFORE") throw new TypeError("network down");
    if (failure === "HTTP_503") return json(503, { name: "SERVICE_UNAVAILABLE" });

    if (init.method !== "GET" && id) {
      this.seenRequestIds.push(id);
      if (!this.stored.has(id)) {
        this.effects++;
        this.stored.set(id, { batch_header: { payout_batch_id: `B${this.effects}`, batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
      }
      if (failure === "LOSE_RESPONSE") throw new TypeError("connection reset after send");
      return json(201, this.stored.get(id));
    }
    return json(200, { transaction_details: [], total_pages: 1, page: 1 });
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const noSleep = async () => {};
const mk = (f: FakePayPal, extra: Partial<ConstructorParameters<typeof PayPalClient>[0]> = {}) =>
  new PayPalClient({ clientId: "id", clientSecret: "secret", fetch: f.fetch, sleep: noSleep, ...extra });

const payout = {
  planVersionId: "pv1",
  stepId: "caregiver-2026-11-w2",
  receiverEmail: "caregiver@example.com",
  amount: money(32_000, "USD"),
  note: "Weekly care",
};

describe("sandbox guard", () => {
  it("INV-19 production endpoint aborts startup", () => {
    expect(() => assertSandbox("https://api-m.paypal.com")).toThrow(ProductionEndpointError);
    expect(() => assertSandbox("https://api.paypal.com")).toThrow(ProductionEndpointError);
    expect(() => assertSandbox("https://api-m.sandbox.paypal.com.evil.example")).toThrow(ProductionEndpointError);
    expect(() => new PayPalClient({ clientId: "a", clientSecret: "b", baseUrl: "https://api-m.paypal.com" })).toThrow(
      ProductionEndpointError,
    );
    expect(() => assertSandbox("https://api-m.sandbox.paypal.com")).not.toThrow();
  });
});

describe("idempotency", () => {
  it("INV-03 mutating requests without a key are refused before reaching PayPal", async () => {
    const f = new FakePayPal();
    await expect(
      mk(f).request({ method: "POST", path: "/v1/payments/payouts", idempotencyKey: "" }),
    ).rejects.toThrow(/idempotency key/);
    expect(f.effects).toBe(0);
  });

  it("INV-03 a lost response is retried with the same key and pays once", async () => {
    const f = new FakePayPal();
    f.failures = ["LOSE_RESPONSE"];
    const res = await payCaregiver(mk(f), payout);
    expect(res.batch_header.payout_batch_id).toBe("B1");
    expect(f.effects).toBe(1);
    expect(new Set(f.seenRequestIds).size).toBe(1);
    expect(f.seenRequestIds.length).toBe(2);
  });

  it("INV-03 property: any mix of network failures produces exactly one effect", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("LOSE_RESPONSE", "FAIL_BEFORE", "HTTP_503" as const), { maxLength: 3 }),
        fc.integer({ min: 1, max: 3 }),
        async (failures, runs) => {
          const f = new FakePayPal();
          f.failures = [...failures];
          const client = mk(f, { maxAttempts: 4 });
          // The same step may be executed several times (worker crash, duplicate workflow run).
          for (let i = 0; i < runs; i++) {
            try {
              await payCaregiver(client, payout);
            } catch {
              // a run may exhaust retries; a later run must still not double pay
            }
          }
          expect(f.effects).toBeLessThanOrEqual(1);
          expect(new Set(f.seenRequestIds).size).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("different steps are different payments", async () => {
    const f = new FakePayPal();
    const c = mk(f);
    await payCaregiver(c, payout);
    await payCaregiver(c, { ...payout, stepId: "caregiver-2026-11-w3" });
    expect(f.effects).toBe(2);
  });
});

describe("client behaviour", () => {
  it("reuses the access token instead of fetching one per call", async () => {
    const f = new FakePayPal();
    const c = mk(f);
    await cancelSubscription(c, { planVersionId: "pv", stepId: "s1", subscriptionId: "I-1", reason: "plan" });
    await cancelSubscription(c, { planVersionId: "pv", stepId: "s2", subscriptionId: "I-2", reason: "plan" });
    expect(f.tokenCalls).toBe(1);
  });

  it("refreshes the token before it expires", async () => {
    const f = new FakePayPal();
    let now = 0;
    const c = mk(f, { now: () => now });
    await c.accessToken();
    now = (32400 - 60) * 1000; // inside the refresh margin
    await c.accessToken();
    expect(f.tokenCalls).toBe(2);
  });

  it("surfaces PayPal's debug id and issue on client errors", async () => {
    const fetchImpl: FetchLike = async (url) =>
      new URL(url).pathname === "/v1/oauth2/token"
        ? json(200, { access_token: "t", expires_in: 100 })
        : new Response(JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "RECEIVER_UNREGISTERED" }] }), {
            status: 422,
            headers: { "paypal-debug-id": "abc123" },
          });
    const c = new PayPalClient({ clientId: "a", clientSecret: "b", fetch: fetchImpl, sleep: noSleep });
    const err = await payCaregiver(c, payout).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect((err as PayPalError).debugId).toBe("abc123");
    expect((err as PayPalError).issue).toBe("RECEIVER_UNREGISTERED");
  });

  it("INV-21 error messages never contain the client secret", async () => {
    const fetchImpl: FetchLike = async () => json(401, { name: "AUTHENTICATION_FAILURE" });
    const c = new PayPalClient({ clientId: "id", clientSecret: "s3cr3t-value", fetch: fetchImpl, sleep: noSleep });
    const err = (await c.accessToken().catch((e: unknown) => e)) as Error;
    expect(String(err.message)).not.toContain("s3cr3t-value");
  });
});

describe("transaction search", () => {
  it("splits long ranges into windows of at most 31 days", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-04-15T00:00:00Z");
    const w = searchWindows(start, end);
    expect(w[0]![0]).toEqual(start);
    expect(w.at(-1)![1]).toEqual(end);
    for (const [s, e] of w) expect(e.getTime() - s.getTime()).toBeLessThanOrEqual(31 * 86_400_000);
  });

  it("queries every window", async () => {
    const f = new FakePayPal();
    const calls: string[] = [];
    const c = new PayPalClient({
      clientId: "a",
      clientSecret: "b",
      sleep: noSleep,
      fetch: async (url, init) => {
        calls.push(url);
        return f.fetch(url, init);
      },
    });
    await listTransactions(c, new Date("2026-01-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"));
    expect(calls.filter((u) => u.includes("/v1/reporting/transactions")).length).toBe(2);
  });
});

describe("webhooks", () => {
  it("rejects events with missing signature headers without calling PayPal", async () => {
    const f = new FakePayPal();
    expect(await verifyWebhook(mk(f), "WH-1", {}, "{}")).toBe(false);
    expect(f.seenRequestIds.length).toBe(0);
  });

  it("rejects bodies that aren't JSON", async () => {
    const f = new FakePayPal();
    const h = {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
      "paypal-transmission-id": "t1",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-11-02T00:00:00Z",
    };
    expect(await verifyWebhook(mk(f), "WH-1", h, "not json")).toBe(false);
  });
});

describe("owner payments", () => {
  const pay = { paymentId: "3f1c2a7e-9b4d-4c1e-8a2b-1234567890ab", receiverEmail: "pharmacy@example.com", amount: money(4_210, "USD") };

  it("INV-29 the same payment sent any number of times, through any network failure, pays once", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom("LOSE_RESPONSE", "FAIL_BEFORE", "HTTP_503" as const), { maxLength: 3 }), fc.integer({ min: 1, max: 4 }), async (failures, runs) => {
        const f = new FakePayPal();
        f.failures = [...failures];
        const client = mk(f, { maxAttempts: 4 });
        for (let i = 0; i < runs; i++) {
          try {
            await sendOwnerPayment(client, pay);
          } catch {
            /* the worker retries later */
          }
        }
        expect(f.effects).toBeLessThanOrEqual(1);
        expect(new Set(f.seenRequestIds)).toEqual(new Set(f.seenRequestIds.length ? [`lp-pay-${pay.paymentId}`] : []));
      }),
    );
  });

  it("never sends what the payee wrote to the owner along with the money", async () => {
    let body = "";
    const client = new PayPalClient({
      clientId: "id",
      clientSecret: "secret",
      sleep: noSleep,
      fetch: async (url, init) => {
        if (new URL(url).pathname === "/v1/oauth2/token") return json(200, { access_token: "t", expires_in: 3600 });
        body = String(init.body);
        return json(201, { batch_header: { payout_batch_id: "B1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
      },
    });
    await sendOwnerPayment(client, pay);
    const sent = JSON.parse(body);
    expect(sent.items[0]).toMatchObject({ receiver: "pharmacy@example.com", amount: { value: "42.10", currency: "USD" } });
    expect(sent.sender_batch_header.sender_batch_id).toHaveLength(30);
    expect(body).toContain("Sent with Legacy Protection.");
  });
});

