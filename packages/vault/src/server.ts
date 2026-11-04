/**
 * The vault as a small HTTP service. Each client (web, worker) has its own
 * secret and signs every request: HMAC-SHA256 over method, path, timestamp
 * and body. Requests more than 60 seconds old are refused, so a captured
 * request can't be replayed later.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { CLIENTS, KINDS, type ClientId, type Kind } from "./core.js";
import type { KeyStore } from "./keystore.js";

const MAX_SKEW_MS = 60_000;

export function signRequest(secret: string, method: string, path: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${method}\n${path}\n${timestamp}\n${body}`).digest("hex");
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error("too large");
  }
  return body;
}

export function createVaultServer(store: KeyStore, clientSecrets: Partial<Record<ClientId, string | undefined>>, now = () => Date.now()): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true });
      if (req.method !== "POST" || (req.url !== "/v1/keys/write" && req.url !== "/v1/keys/read")) return send(404, { error: "not_found" });

      const client = String(req.headers["x-vault-client"] ?? "") as ClientId;
      const ts = String(req.headers["x-vault-timestamp"] ?? "");
      const sig = String(req.headers["x-vault-signature"] ?? "");
      const secret = CLIENTS.includes(client) ? clientSecrets[client] : undefined;
      const body = await readBody(req);
      if (!secret || !/^\d{13}$/.test(ts) || Math.abs(now() - Number(ts)) > MAX_SKEW_MS) return send(401, { error: "unauthorized" });
      const want = Buffer.from(signRequest(secret, "POST", req.url, ts, body), "hex");
      const got = Buffer.from(sig.length === 64 ? sig : "00", "hex");
      if (want.length !== got.length || !timingSafeEqual(want, got)) return send(401, { error: "unauthorized" });

      const j = JSON.parse(body) as { kind?: string; purpose?: string; ownerRef?: string; keyId?: string };
      const kind = j.kind as Kind;
      if (!KINDS.includes(kind) || typeof j.purpose !== "string" || j.purpose.length > 40) return send(400, { error: "bad_request" });

      const r =
        req.url === "/v1/keys/write"
          ? typeof j.ownerRef === "string" && /^[0-9a-f-]{36}$/.test(j.ownerRef)
            ? await store.keyForWrite(client, j.ownerRef, kind, j.purpose)
            : null
          : typeof j.keyId === "string" && /^[0-9a-f-]{36}$/.test(j.keyId)
            ? await store.keyForRead(client, j.keyId, kind, j.purpose)
            : null;
      if (!r) return send(400, { error: "bad_request" });
      if (!r.ok) return send(r.reason === "RATE_LIMITED" ? 429 : 403, { error: r.reason });
      return send(200, { keyId: r.keyId, key: r.key.toString("base64") });
    } catch {
      return send(500, { error: "internal" });
    }
  });
}
