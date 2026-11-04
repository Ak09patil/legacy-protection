# Invariants

These are the guarantees Legacy Protection must hold at all times, under every input, retry, crash and race. They are the contract the code is built against, not a description written afterwards.

**How to read this file**

- Every invariant has a stable ID (`INV-xx`). IDs are never reused or renumbered.
- **Enforced in** names the single place in the code that is responsible for the guarantee. Code that enforces an invariant carries a comment with its ID, e.g. `// INV-03`.
- **Verified by** names the tests that prove it. Every test that checks an invariant has the ID in its name, so `pnpm test -t INV-03` runs exactly those tests. CI fails if any invariant listed here has no test.
- Changing or removing an invariant requires an Architecture Decision Record (`docs/adr/`).

Terms: **owner** = the account holder who sets up a plan. **Trusted contact** = the person the owner names to help. **Executor** = the legal representative of the estate. **Plan** = the owner's confirmed instructions. **Money action** = any call that moves, holds, releases or cancels money (payouts, invoice cancellation, subscription cancellation, holds).

---

## A. Money movement

### INV-01 — The AI never moves money
Language models may draft plans, classify text and write explanations. They never call PayPal. Only the executor worker holds PayPal credentials, and it acts only on decisions produced by the deterministic policy engine.

- **Why:** model output is probabilistic and can be manipulated by injected text. Money needs a decision path that is deterministic, reviewable and replayable.
- **Enforced in:** `workers/executor` is the only deployable with `PAYPAL_CLIENT_SECRET` in its environment. `packages/ai` has no dependency on `packages/paypal` (checked by a dependency-boundary lint rule).
- **Verified by:** `INV-01 dependency boundary`; `INV-01 ai output cannot reach executor without policy decision`.

### INV-02 — No money action without authority
A money action runs only if one of these is true:
(a) the owner approved this specific action live, with a fresh authentication; or
(b) the action is part of the owner's **current confirmed plan version** and the plan's trigger is in state `ACTIVATED`.

- **Enforced in:** `packages/policy` — `authorize(action, context)` is the only function that can produce an `AuthorizedAction`, and the executor accepts only that type.
- **Verified by:** `INV-02 property: no action authorized without approval or activated plan`.

### INV-03 — Every money action happens exactly once
Each money action carries an idempotency key derived only from `(plan_version_id, step_id)` — never from time, attempt number or random values — and is sent as PayPal's `PayPal-Request-Id`. Retries, worker crashes and duplicate workflow runs cannot produce a second effect.

- **Enforced in:** `packages/paypal` — the client refuses any mutating request without an idempotency key. Keys are derived in `packages/core/idempotency.ts`.
- **Verified by:** `INV-03 property: random crash/retry sequences produce one effect`; `INV-03 chaos: kill worker mid-payout`.

### INV-04 — Money only goes where the law sends it
When a plan activates, the remaining balance is never paid out to the trusted contact, a beneficiary or any destination chosen by the plan. It is held and released only through the estate's documented process. The plan may continue **pre-authorized recurring obligations** the owner set up (e.g. paying a registered caregiver) up to the limits the owner confirmed.

- **Why:** RUFADAA governs access to digital accounts. It does not let a platform move assets around probate. Claiming otherwise would be legally wrong.
- **Enforced in:** `packages/policy` — no rule type exists that pays an arbitrary payee from an activated plan. Continued payments are limited to `RegisteredObligation` records with owner-confirmed caps.
- **Verified by:** `INV-04 activated plan cannot pay unregistered payee`; `INV-04 obligation payments respect owner caps`.

### INV-05 — Money is never a float
All amounts are stored and computed as integers in the currency's minor unit (cents), always paired with an ISO-4217 currency code. Mixing currencies in arithmetic is a type error.

- **Enforced in:** `packages/core/money.ts` (`Money` type). Python risk service uses `Decimal` at its boundary and receives integer minor units.
- **Verified by:** `INV-05 money arithmetic`; lint rule banning `parseFloat`/`Number()` on amount fields.

---

## B. Triggers and authority

### INV-06 — A plan never activates on a single signal
Activation requires all of:
1. a missed check-in sequence (the owner did not respond to the scheduled check-in and every reminder);
2. an independent confirmation from the trusted contact, authenticated with a passkey;
3. the owner's chosen waiting period elapsing with no owner activity.

- **Enforced in:** the `PlanLifecycle` workflow (`workers/executor/workflows/plan-lifecycle.ts`), modelled on the state machine in `packages/core/lifecycle.ts`.
- **Verified by:** `INV-06 property: no event sequence lacking all three conditions reaches ACTIVATED`.

### INV-07 — The owner always wins
Any authenticated owner activity — a check-in, a login, a cancel — immediately returns the plan to `ACTIVE_MONITORING` from any state before `EXECUTING`, and cancels pending activation.

- **Enforced in:** `PlanLifecycle` signal handler `ownerActivity`.
- **Verified by:** `INV-07 owner activity cancels activation from every pre-execution state`.

### INV-08 — Separation of powers
The trusted contact can never: edit the plan, add payees, receive money from the plan, see message or memo content unless the owner explicitly allowed it (INV-17), or activate a plan alone. The executor sees only what the estate process grants. No role can grant itself more access.

- **Enforced in:** `packages/policy/roles.ts` — permissions are a static table, not data stored per user.
- **Verified by:** `INV-08 role permission matrix`; `INV-08 contact cannot be payee`.

### INV-09 — Plans are immutable once confirmed
Editing a plan creates a new version. Confirmed versions are never modified. Every decision references the exact version it ran under.

- **Enforced in:** `packages/db/migrations/001_init.sql` — no UPDATE grant for the application role, plus a trigger that rejects updates even from the table owner.
- **Verified by:** `INV-09 confirmed version cannot be updated`.

---

## C. Risk decisions

### INV-10 — Fail closed
If the risk service or the policy engine is unavailable, times out or returns invalid output, the payment under review is **held**, never passed. If only the AI reader of the payee's message is unavailable, keyword checks still apply and the owner must confirm the payment (REVIEW) before any money moves: never passed unread, but an AI outage doesn't freeze everyone's payments. (Changed 2026-11-05, see the change log.)

- **Enforced in:** `packages/policy/decide.ts` — the default branch of every decision returns `HOLD` with reason `DEPENDENCY_UNAVAILABLE`.
- **Verified by:** `INV-10 risk service timeout holds payment`; `INV-10 malformed model output holds payment`.

### INV-11 — Models can only add caution
Decisions combine hard rules and model scores. A model score can raise a decision (pass → review → hold). It can never lower a decision a hard rule made.

- **Enforced in:** `packages/policy/decide.ts` — the final decision is `max(ruleDecision, modelDecision)` on the ordered scale `PASS < REVIEW < HOLD`.
- **Verified by:** `INV-11 property: model score never lowers rule decision`.

### INV-12 — Every hold has a reason a person can read
Every `REVIEW` or `HOLD` carries at least one plain-language reason derived from the rule that fired or the top model features (SHAP). "The model said so" is not a valid reason.

- **Enforced in:** `Decision` type requires a non-empty `reasons` array; the risk service rejects responses without explanations.
- **Verified by:** `INV-12 decisions always carry reasons`.

### INV-13 — Network signals stay private
The abuse-ring sentinel may use patterns across many accounts as risk features. It never reveals to any user anything about another user: no names, no counts that identify someone, no "another customer paid this person."

- **Enforced in:** the risk service returns only feature contributions phrased about the payee's pattern (e.g. "this payee recently received first-time payments from many unrelated accounts"), never identities. Reason templates are fixed strings with numeric buckets, not free text.
- **Verified by:** `INV-13 reasons contain no other-account identifiers`.

### INV-14 — Registered caregivers aren't treated as rings
A caregiver legitimately paid by several households looks like a ring to a naive network detector. Payees registered as household employees by an owner are evaluated with that context. Network signals alone can raise them to `REVIEW`, never to `HOLD`.

- **Enforced in:** `packages/policy/decide.ts` — network-only signals on a `RegisteredObligation` payee cap at `REVIEW`.
- **Verified by:** `INV-14 registered caregiver with high in-degree capped at review`.

---

## D. Evidence, privacy and environment

### INV-15 — The audit log is append-only and tamper-evident
Every decision, approval, state change and money action is written to `audit_events`. Each row stores the SHA-256 hash of its content plus the previous row's hash for the same plan. The application role can insert but never update or delete. A verifier recomputes the chain and reports the first broken link.

- **Enforced in:** `packages/db/src/audit.ts` (hash chain, per-plan advisory lock), plus database triggers and grants in `packages/db/migrations/001_init.sql`.
- **Verified by:** `INV-15 tampered row detected`; `INV-15 app role cannot update or delete`.

### INV-16 — Every decision is reproducible
Each decision records its inputs, the policy version, the model version and the plan version, so it can be re-run later and produce the same result.

- **Enforced in:** `Decision` record schema.
- **Verified by:** `INV-16 replaying a recorded decision yields the same result`.

### INV-17 — Catalogue, not content
Following RUFADAA's distinction, the trusted contact and executor may see the **catalogue** of activity (date, counterparty, amount, category). They never see **content** (payment notes, memos, messages) unless the owner explicitly allowed it in the plan.

- **Enforced in:** `packages/policy/views.ts` — the contact and executor views are built from an allow-listed field set.
- **Verified by:** `INV-17 contact view excludes memo content`.

### INV-18 — Untrusted text is data, never instructions
Invoice notes, payment memos, payee names and any other text from outside the system are passed to models only as clearly delimited data. Model output that tries to change permissions, payees or amounts is discarded.

- **Enforced in:** `packages/ai/prompting.ts` (structured inputs) and Zod schemas that admit only classification labels and explanation text.
- **Verified by:** `INV-18 prompt-injection corpus produces no privileged output`.

### INV-19 — Sandbox only
Every service refuses to start if any PayPal endpoint or credential points at production.

- **Enforced in:** `packages/config` startup check.
- **Verified by:** `INV-19 production endpoint aborts startup`.

### INV-20 — Time is UTC; schedules respect the owner's clock
Timestamps are stored in UTC. Check-ins are scheduled in the owner's time zone and remain correct across daylight-saving changes. A missed check-in is never declared because of a clock change.

- **Enforced in:** `packages/core/schedule.ts`.
- **Verified by:** `INV-20 property: DST transitions never cause a missed check-in`.

### INV-21 — No secrets or personal data in logs
Logs carry IDs and trace IDs, never credentials, tokens, full names, emails or memo content.

- **Enforced in:** the shared logger's redaction list; secret scanning in CI.
- **Verified by:** `INV-21 logger redacts sensitive fields`.

### INV-22 — No one can sign in with what's in the database
There are no passwords. People sign in with passkeys only. Session and invite tokens are stored as SHA-256 hashes, so a copy of the database cannot be used to sign in or accept an invite. A person's role on a plan comes only from a membership created through the owner's invite, never from the request.

- **Enforced in:** `packages/db/migrations/002_accounts.sql` (schema), `apps/web/src/server/auth.ts`.
- **Verified by:** `INV-22 only token hashes are stored`, `INV-22 a plan has at most one active trusted contact`.

### INV-23 — A model with no baseline can ask, not hold
When the owner has fewer than 10 past payments, the behaviour model has nothing to compare against. Its signal can ask the owner to confirm (REVIEW) but cannot hold a payment on its own. Rules, scam-language labels and network signals can still hold. Without this, every new user's first payments were held, which trains people to click through warnings.

- **Enforced in:** `packages/policy/src/decide.ts` (`COLD_START_MIN_HISTORY`).
- **Verified by:** `INV-23 cold start caps behaviour-only model signals at REVIEW`, `INV-23 rules still hold during cold start`.

### INV-24 — A stolen database reveals nothing private
Payment notes (what scammers wrote to the owner) and plan documents (the people in the plan) are stored in the main database only as ciphertext. Each plan has its own keys, held by a separate vault service with its own database, wrapped by a master key held outside both. The vault releases a key only for a purpose allowed by a fixed table (the worker can never read payment notes), logs every request in an append-only log, and rate-limits each client. Ciphertexts are bound to their plan and kind, so they can't be moved or reinterpreted.

- **Enforced in:** `packages/vault` (service, policy, envelope encryption), `packages/service` and `apps/web/src/server` (fields sealed before they're written).
- **Verified by:** `INV-24 the main database only ever holds ciphertext, bound to its plan and kind`, `INV-24 the worker can never read what scammers wrote to the owner`, `INV-24 every release, allowed or refused, is logged, and the log can't be edited`, `INV-24 a wrong secret, another client's secret, or an old replayed request is refused`.

---

## Change log

| Date | Change | ADR |
|---|---|---|
| 2026-11-02 | Initial set INV-01 to INV-21 | ADR-0001 to ADR-0005 |
| 2026-11-04 | Added INV-22 (accounts and sign-in) | — |
| 2026-11-04 | Added INV-23 (cold start), found in end-to-end testing | — |
| 2026-11-05 | Added INV-24 (sensitive fields sealed by a separate vault) | ADR-0007 |
| 2026-11-05 | INV-10: an AI text-reader outage asks the owner (REVIEW) instead of holding; risk-service outages still hold. Found when a model outage held a carer's routine payment. | — |
