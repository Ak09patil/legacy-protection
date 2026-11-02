# ADR-0004: Keep the AI outside the money path

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The product uses AI in three places: turning the owner's plain-English wishes into a structured plan, classifying risky text, and writing explanations. It would be easy to let an agent call PayPal tools directly.

## Decision

The AI proposes; deterministic code decides; one isolated worker acts (INV-01).

- **Plan drafting:** the model outputs a plan draft validated by a Zod schema. The owner reviews every rule in plain language and confirms it. Only confirmed versions have authority (INV-02, INV-09).
- **Risk text classification:** output limited to a fixed set of labels.
- **Explanations:** generated from structured decision data, never the source of the decision.
- **Agent actions:** when the executor runs a step, it uses PayPal's Agent Toolkit functions, but the step list comes from the policy engine, not from the model.

## Consequences

- The system remains correct if the model is wrong, down or manipulated (INV-10, INV-18).
- Every money action can be traced to a confirmed plan version or a live approval.
- We give up "let the agent figure it out" flexibility. For other people's money, that is the right trade.
