# ADR-0002: A separate Python risk service

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Holding an older person's payment is a serious act. It has to be accurate, measured, and explainable to the owner and their family in plain language (INV-12).

## Options

1. **Rules only, in TypeScript.** Fully explainable, one language. No way to learn per-owner baselines or combine weak signals, and no meaningful accuracy metrics.
2. **An LLM judges each payment.** Flexible, but non-deterministic, hard to measure, expensive per call, and open to manipulation by injected text (INV-18).
3. **Hard rules in TypeScript plus a gradient-boosted model with SHAP explanations in Python.** Rules catch the clear cases; the model combines weaker signals; SHAP gives a per-decision explanation.

## Decision

Option 3. A FastAPI service in Python runs:

- a LightGBM classifier over transaction and payee features;
- a per-owner anomaly detector (amount, timing and payee novelty against the owner's own history);
- abuse-ring network features (ADR-0005);
- SHAP explanations mapped to fixed plain-language reason templates.

An LLM is used only to classify the *text* of memos and invoices into risk labels (urgency, gift-card request, impersonation), as one input feature.

## Consequences

- The model can only add caution (INV-11). Outages fail closed (INV-10).
- A second language and service: strict typing (mypy strict), its own tests and CI job.
- Training and evaluation data are synthetic, generated from scam typologies in the FBI IC3 reports, and labelled as synthetic everywhere (MODEL_CARD.md). Age is deliberately not a feature.
- Metrics (precision, recall, false-hold rate at the chosen threshold) are reproducible with one command (EVALUATION.md).
