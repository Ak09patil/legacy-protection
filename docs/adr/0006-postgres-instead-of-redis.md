# ADR-0006: Postgres instead of Redis for caching, rate limits and webhook de-duplication

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Three small jobs usually go to Redis:

1. caching the PayPal OAuth access token;
2. rate limiting (check-ins, sign-in attempts, hold releases);
3. remembering which webhook events were already processed.

## Options

1. **Redis** alongside Postgres.
2. **Postgres only**, plus in-process memory for the token.

## Decision

Option 2.

- **Token:** each worker keeps its own PayPal access token in memory and refreshes it before expiry. No shared storage needed.
- **Rate limits:** a `rate_limits` table holding token buckets, updated with a single atomic `INSERT ... ON CONFLICT DO UPDATE`.
- **Webhook de-duplication:** a `processed_webhook_events` table with a unique constraint on the PayPal event ID, written **in the same transaction** as the state change the event causes.

## Consequences

- **Correctness improves.** With Redis, a crash between "mark event processed" and "apply its effect" could lose an effect. In one Postgres transaction both happen or neither does (supports INV-03).
- One fewer service to secure, monitor, back up and pay for; one fewer thing that can be down during judging.
- No native key expiry: rows carry `expires_at`, reads ignore expired rows, and a scheduled job deletes them.
- Lookups cost about a millisecond instead of less. Irrelevant at our volume.

## When we would revisit this

Add Redis (or another in-memory store) when any of these becomes true:

- rate-limit writes exceed roughly 1,000 per second sustained, enough to compete with transactional load;
- we need a shared sub-millisecond cache across regions;
- profiling shows rate-limit or cache queries in the database's top sources of load.
