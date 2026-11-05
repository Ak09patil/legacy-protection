# Model Card: Legacy Protection Risk Models

**Status:** interim model trained on calibrated synthetic data; real normal-spending data (DCPC) pending.

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

## Metrics

**Interim results on synthetic data** (`services/risk/reports/metrics.json`, model `risk-lgbm-70f402efa681`). Normal payments are interim synthetic data until the DCPC files are loaded; these numbers will change, and synthetic data flatters any model. Measured on owners the model never saw in training.

| Measure | Value |
|---|---|
| ROC AUC | 0.987 |
| Scam payments flagged (review or hold) | 89.6% |
| Scam payments held | 78.0% |
| Normal payments wrongly held | 0.48% (target 0.5%) |
| Normal payments sent for review | 3.29% |
| Flagged by scam type | tech support 99%, investment 99%, family emergency 93%, government impersonation 93%, **romance 68%** |
| Grooming payments flagged | 0%: small trust-building payments look exactly like normal payments when they happen. The model doesn't try; the relationship rules (INV-27) watch the whole relationship instead. |
| Legitimate new payees wrongly held | 0% |
| Legitimate large payments wrongly held | 3.3% |

Reproduce with `cd services/risk && PYTHONPATH=src python -m risk.train`.

**What these numbers don't show:** performance on real scams. Romance scams are the hardest case, as they are in reality, because the victim pays someone they have come to trust.

## How it gets smarter (INV-28)

The model learns from what really happened, on three time scales, and none of them can make it less protective.

1. **The same day, with no retraining.** When the owner tells us a payment was a scam ("Was it a scam?" after she stops one; "This was a scam" on one that went), that payee is flagged for everyone: one household's report means others are asked, two or more mean the payment is paused. A household counts once, its latest answer counts, a carer someone registered is only ever asked about, and nothing about who reported is shown (INV-13).
2. **New scam words without breaking anything.** The app labels scam language (now including investment pitches, withdrawal fees and romance, in three languages) and sends every label to the model. The model counts the words it was trained on and ignores the rest, returning them as `ignoredLabels`; a malformed label is still refused. When the model is retrained on real outcomes, words seen on confirmed scams join its vocabulary.
3. **Retraining on real outcomes, behind a gate.** `pnpm risk:export` writes anonymous outcomes (households and payees as keyed hashes, scam-word labels, never message text; labels only from owners, never payees). `python -m risk.train --real` trains a candidate, weighting real outcomes 5× synthetic ones. `python -m risk.promote` then requires:
   - every confirmed real scam the current model catches, the candidate catches too;
   - at least as many synthetic scams caught (within half a point);
   - no more ordinary payments held (a quarter of a point at most, never over 1%; half a point on real payments people said were fine);
   - more scam words can never lower the score (a monotonic constraint in training, checked again at the gate);
   - and a person runs it again with `--approve`. The previous model is kept for a one-command rollback.

On stand-in outcomes in the export format, with a "trading mentor" pattern the synthetic data never contains, the first model caught 0 of 160 held-out scam payments; after retraining, 160 of 160, holding fewer ordinary payments (1.8% → 0%). Stand-in data flatters, like all synthetic data; the point is that the loop learns and the gate holds.

The gate found a real problem on its first run: the model trained before the monotonic constraint could, for some payments, score *lower* when a scam word was added. The current model was retrained with the constraint, passed the gate, and replaced it.

**What learning can't do:** it can't stop a scam nobody reports, so unreported scams stay "matured" normal rows; we only count a sent payment as normal after 60 days without a report. And a scammer can't teach it: payees never give labels.

## Thresholds

Chosen to keep the **false-hold rate on real normal transactions** below a stated target, because wrongly holding an older person's legitimate payment has a real cost. The target and resulting recall are recorded here when set.
