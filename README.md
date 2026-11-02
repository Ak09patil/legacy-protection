# Legacy Protection

**A trust feature designed for PayPal: protection while you're well, defence against scams as you age, and a dignified handover when you can no longer act.**

> Work in progress for the PayPal AI Hackathon (submissions close Nov 12, 2026). Sandbox only: this project never touches real money.

## Why

Americans over 60 reported $7.7 billion in fraud losses to the FBI in 2025. When someone dies or loses capacity, families still close PayPal accounts by emailing and mailing documents. Under RUFADAA, adopted by most US states, a platform's own "online tool" for account wishes takes priority over a will. Google, Facebook and Apple offer one. Legacy Protection is that tool for PayPal.

## Design principles

- **The AI never moves money.** It drafts and explains; a deterministic policy engine decides; one isolated worker acts.
- **Fail closed.** If anything is uncertain or unavailable, the payment is held, never waved through.
- **Exactly once.** Every money action is idempotent, so retries and crashes can never pay twice.
- **The trusted contact is also a threat.** Activation needs missed check-ins, a passkey-verified confirmation and a waiting period; the owner always wins.

## Read first

- [Invariants](docs/INVARIANTS.md): the 21 guarantees the system is built against, each linked to its tests
- [Threat model](docs/THREAT_MODEL.md)
- [Architecture decisions](docs/adr/README.md)
- [Model card](docs/MODEL_CARD.md)

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Money, idempotency keys, plan lifecycle state machine |
| `packages/policy` | Decision engine, hard rules, role permissions |
| `services/risk` | Python risk service, including the abuse-ring sentinel |
| `docs/` | Invariants, threat model, ADRs, model card |

## Running the tests

```bash
pnpm install && pnpm test && pnpm typecheck
cd services/risk && pip install -e ".[dev]" && pytest -q && mypy src
node scripts/check-invariant-coverage.mjs
```

## Licence

MIT
