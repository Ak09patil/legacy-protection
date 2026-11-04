import "server-only";

/**
 * Client for the Python risk service (services/risk). Any failure, timeout
 * or malformed answer becomes UNAVAILABLE, and the policy engine holds the
 * payment (INV-10). Nothing here can make a payment less cautious.
 */

import type { ModelOutcome, ModelSignal, TextLabel } from "@lp/policy";
import { z } from "zod";

const SignalSchema = z.object({
  level: z.enum(["PASS", "REVIEW", "HOLD"]),
  reasons: z.array(z.object({ code: z.string().max(64), text: z.string().max(300), source: z.enum(["MODEL", "NETWORK"]) })).max(10),
  networkOnly: z.boolean(),
  modelVersion: z.string().max(64),
});

export interface ScoreInput {
  payeeId: string;
  amountMinor: number;
  at: Date;
  hourLocal: number;
  method: "p2p" | "bank_transfer" | "gift_card" | "crypto";
  textLabels: TextLabel[];
  history: Array<{ payeeId: string; amountMinor: number; at: Date }>;
}

async function post(path: string, body: unknown): Promise<ModelSignal> {
  const base = process.env.RISK_URL;
  if (!base) throw new Error("RISK_URL is not set");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.RISK_TOKEN ? { Authorization: `Bearer ${process.env.RISK_TOKEN}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.RISK_TIMEOUT_MS ?? 2500)),
  });
  if (!res.ok) throw new Error(`risk service ${res.status}`);
  return SignalSchema.parse(await res.json());
}

export async function assessPayment(input: ScoreInput): Promise<ModelOutcome> {
  try {
    const [model, network] = await Promise.all([
      post("/v1/score", {
        payeeId: input.payeeId,
        amountMinor: input.amountMinor,
        currency: "USD",
        at: input.at.toISOString(),
        hourLocal: input.hourLocal,
        method: input.method,
        textLabels: input.textLabels,
        history: input.history.slice(-5000).map((h) => ({ payeeId: h.payeeId, amountMinor: h.amountMinor, at: h.at.toISOString() })),
      }),
      post("/v1/network/payee", { payeeId: input.payeeId }),
    ]);
    return { status: "OK", signals: [model, network] };
  } catch (e) {
    return { status: "UNAVAILABLE", detail: e instanceof Error ? e.message.slice(0, 100) : "unknown" };
  }
}
