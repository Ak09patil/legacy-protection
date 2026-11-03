"""Per-payment features, computed only from what was known before the payment.

The same function serves training and the live API, so they can't drift.
The owner's age and other protected characteristics are never features.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import median

METHODS = ("p2p", "bank_transfer", "gift_card", "crypto")
TEXT_LABELS = (
    "GIFT_CARD_REQUEST",
    "CRYPTO_REQUEST",
    "URGENCY",
    "IMPERSONATION_GOVERNMENT",
    "IMPERSONATION_TECH_SUPPORT",
    "IMPERSONATION_FAMILY",
)

FEATURE_NAMES = (
    "log_amount",
    "amount_ratio_to_typical",
    "payee_is_new",
    "days_since_payee_first_seen",
    "payments_last_24h",
    "amount_last_72h_ratio",
    "hour_local",
    "method_code",
    "text_scam_label_count",
)


@dataclass(frozen=True)
class PastPayment:
    payee_id: str
    amount_minor: int
    at: int


@dataclass(frozen=True)
class Payment:
    payee_id: str
    amount_minor: int
    at: int
    hour_local: int
    method: str
    text_labels: tuple[str, ...]


def compute(p: Payment, history: list[PastPayment]) -> list[float]:
    prior = [h for h in history if h.at < p.at]
    amounts = [h.amount_minor for h in prior]
    typical = median(amounts) if amounts else None
    first_seen = min((h.at for h in prior if h.payee_id == p.payee_id), default=None)
    last_24h = [h for h in prior if p.at - h.at <= 86_400]
    last_72h_sum = sum(h.amount_minor for h in prior if p.at - h.at <= 3 * 86_400)
    return [
        math.log1p(p.amount_minor),
        (p.amount_minor / typical) if typical else 1.0,
        1.0 if first_seen is None else 0.0,
        -1.0 if first_seen is None else (p.at - first_seen) / 86_400,
        float(len(last_24h)),
        ((last_72h_sum + p.amount_minor) / typical) if typical else 1.0,
        float(p.hour_local),
        float(METHODS.index(p.method)) if p.method in METHODS else -1.0,
        float(sum(1 for label in p.text_labels if label in TEXT_LABELS)),
    ]


def compute_for_sorted(rows: list[tuple[Payment, str]]) -> list[list[float]]:
    """Features for many payments, where rows are (payment, owner_id) sorted by owner then time."""
    out: list[list[float]] = []
    history: dict[str, list[PastPayment]] = {}
    for p, owner in rows:
        h = history.setdefault(owner, [])
        out.append(compute(p, h))
        h.append(PastPayment(p.payee_id, p.amount_minor, p.at))
    return out

