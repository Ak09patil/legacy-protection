# ADR-0007: A separate vault for sensitive fields

- **Status:** Accepted (2026-11-05)
- **Invariant:** INV-24

## Context

A copy of the main database (a leaked backup, a SQL-injection bug, a compromised read replica) should not reveal what scammers wrote to an older person, or who the people in their plan are. Splitting data into "two databases" only helps if no single component holds the keys to both.

## Decision

Envelope encryption with a separate key custodian:

- **Main database** (Postgres, role `lp_app`): stores sensitive fields only as ciphertext (`lpv1.<keyId>.<AES-256-GCM>`), bound to their plan and kind by authenticated data, so a ciphertext can't be moved to another plan or read as another kind.
- **Vault service** (`packages/vault`, its own Postgres database): stores one 256-bit data key per (plan, kind), wrapped by a master key that lives in neither database (`VAULT_MASTER_KEY`; a cloud KMS in production).
- **Purpose-bound release:** a client asks for a key *for a stated purpose*; a fixed table decides (`POLICY` in `core.ts`). The worker can open plan documents to run a plan, and **can never read payment notes**. Every request, allowed or refused, goes to an append-only access log; each client is rate-limited.
- **Signed requests:** each client has its own secret and signs every request (HMAC-SHA256 over method, path, timestamp and body); requests older than 60 seconds are refused.

## What an attacker gets

| They obtain | They can read |
|---|---|
| A copy of the main database | Plan state, amounts, dates, risk decisions, the audit trail (IDs only). **Not** payment notes, plan documents, or executor steps. |
| A copy of the vault database | Wrapped keys and an access log. **No** customer data, and the keys are useless without the master key. |
| Both databases | Still nothing sealed, without the master key. |
| The web app's server | What the web app may read, for its allowed purposes, at the rate limit, **with every read logged** in a place the web app can't edit. |
| The worker's server | Plan documents (it needs them to run plans). Never payment notes. |

## Sealed today

- `payments.note`: what the payee wrote ("buy gift cards today…").
- `plan_versions.document` and `plan_drafts.document`: the people in the plan, their emails, amounts and wishes.
- `execution_steps.step`: who gets paid and how much. The readable `label` names no one.

## Not yet sealed (known limitations)

- `users.email` and `users.display_name`: needed for sign-in lookups. Next step: an HMAC blind index for lookups, and names sealed.
- `payments.payee_name` and `payments.payee_email`: used for history matching. Same blind-index approach.
- `invites` and the `notifications` outbox: transient. Outbox rows should be purged after delivery.

## Consequences

- Each page view that shows a plan asks the vault once per minute per plan (keys are cached in memory for 60 seconds).
- Local development runs without the vault service if `VAULT_URL` is unset: fields are stored unsealed, with a loud warning. This is refused in production.
- A failed vault means sealed fields can't be read: plans keep their state, but their details can't be shown or run until the vault is back. The worker retries.
