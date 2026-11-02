# ADR-0005: Abuse-ring sentinel as a network feature of the risk service

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Elder fraud is organised. One scam operation uses mule accounts to collect from many victims. Looking at one owner's history cannot see this; looking across accounts can. This is a capability only a platform with a network view, like PayPal, can offer.

## Options

1. **Skip it.** Simpler; misses the strongest signal against organised fraud.
2. **A separate sentinel service.** Clean separation, but another deployable for a feature that is really a set of risk features.
3. **Network features inside the risk service**, plus an analyst view of flagged payees.

## Decision

Option 3. The risk service maintains a payee graph from protected accounts' outgoing payments and computes, per payee:

- first-time inflow from distinct unrelated payers within a short window (fan-in);
- account age and first-seen date;
- fan-in followed by rapid outflow;
- overlap with payees previously held and confirmed as fraud.

Analysts see flagged payees in an AG Grid view, with the evidence pattern but no identities of the owners involved (INV-13).

## Guardrails

- Network signals only add caution (INV-11).
- Reasons shown to an owner describe the payee's pattern, never another person (INV-13).
- Registered caregivers paid by several households are capped at `REVIEW` on network signals alone (INV-14). This is the most likely false positive, and the household-employer feature gives us the context to avoid it.

## Consequences

- The demo needs a multi-owner synthetic dataset with injected rings and legitimate multi-household caregivers, so we can show both a catch and a correct non-catch.
- In production this would run on PayPal's own network data; the boundary diagram marks it as a PayPal-side capability.
