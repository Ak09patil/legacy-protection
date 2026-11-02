# ADR-0003: A hash-chained Postgres audit log, not a blockchain

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Families, executors and investigators need to trust the record of what the system did. The record must be tamper-evident (INV-15).

## Options

1. **Plain database table.** Easy, but edits are invisible.
2. **Public blockchain.** Strong tamper evidence, but puts financial metadata about vulnerable people on a public ledger, adds cost and latency, and adds nothing when PayPal is already the custodian of the money.
3. **Append-only Postgres table with a per-plan hash chain**, insert-only grants for the application role, and a verifier.

## Decision

Option 3. Each row stores `sha256(content || previous_hash)`. A verifier recomputes the chain and reports the first broken link.

## Consequences

- Tamper-evident, not tamper-proof: a database superuser could rewrite the entire chain. Mitigation for production: publish a periodic digest of chain heads to an external, append-only location. Listed in KNOWN_LIMITATIONS.md.
- No personal data leaves our database.
