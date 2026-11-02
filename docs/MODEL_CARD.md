# Model Card: Legacy Protection Risk Models

**Status:** data plan; metrics are filled in by `services/risk` evaluation runs (see EVALUATION.md).

## Purpose

Flag payments from protected owners that look like elder financial fraud, so they can be held for review with a plain-language reason. The models **only add caution** (INV-11): they can raise a decision from pass to review to hold, never lower a hard rule's decision.

## Principle

**Real data wherever real data exists. Synthetic data only where it cannot exist, calibrated to official statistics and labelled as synthetic.** No public dataset of labelled elder-scam transactions exists, so that part is necessarily synthetic.

## Components and data

| Component | Training data | Real or synthetic |
|---|---|---|
| **Normal-spending anomaly detector** | Federal Reserve Bank of Atlanta, *Diary of Consumer Payment Choice* (DCPC) 2022–2024, transaction-level data joined to individual-level demographics, filtered to older adults | **Real.** Unsupervised; learns only normal behaviour |
| **Scam-text classifier** (payment memos, invoice notes) | UCI SMS Spam Collection; public phishing corpora (licences checked before use) | **Real** messages |
| **Transaction scam classifier** (gradient-boosted, SHAP explanations) | Negatives: DCPC transactions. Positives: synthetic scam payments whose method, size and timing distributions are calibrated to FTC Consumer Sentinel and FBI IC3 statistics for people over 60 | **Hybrid** |
| **Abuse-ring sentinel** (network features) | Synthetic multi-household payment network with injected rings and legitimate multi-household caregivers; network features also evaluated on the public Elliptic transaction-graph dataset | **Synthetic, with a real-data network test** |
| **Pipeline sanity benchmark** | A public card-fraud benchmark (e.g. IEEE-CIS), reported separately, if its licence permits | **Real** |

Every parameter of the synthetic generator records its source in `services/risk/data/calibration.yaml` (for example: *share of scam losses paid by gift card, age 70+: FTC Consumer Sentinel, 2025*).

## Features

Amount relative to the owner's own history and to their age cohort; payee novelty; time since payee first seen; payment method; time of day; velocity; scam-text labels on memos; network features from the sentinel (ADR-0005).

**Deliberately excluded:** the owner's age, gender, race, location or any protected characteristic. Age is used only to choose which public data describes "normal" for the cohort, never as a model input.

## Data we chose not to use

Publicly circulating copies of scraped Venmo transactions. Training a privacy product on other people's leaked financial data would contradict the product's purpose, regardless of availability.

## Known limitations

- DCPC diarists record about 3–4 days each. The detector learns what is normal for a cohort, not for one person over months; per-owner baselines accumulate in the app over time.
- Synthetic scam positives reflect reported fraud. Unreported fraud (a large share, per FTC and FBI) may differ.
- Network features are tested on Bitcoin transaction graphs (Elliptic), a different domain from P2P payments.
- Metrics on synthetic positives overstate real-world performance. Reported numbers always state which data they were measured on.

## Metrics (to be filled by evaluation runs)

| Measure | Data | Value |
|---|---|---|
| Recall at chosen threshold | Held-out synthetic scams | — |
| False-hold rate | Held-out real DCPC transactions | — |
| Text classifier F1 | Held-out real messages | — |
| Ring detection precision / recall | Synthetic network; Elliptic | — |

## Thresholds

Chosen to keep the **false-hold rate on real normal transactions** below a stated target, because wrongly holding an older person's legitimate payment has a real cost. The target and resulting recall are recorded here when set.
