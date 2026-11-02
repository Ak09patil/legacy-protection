"""Abuse-ring sentinel: network risk signals for payees.

Looks across many protected accounts to find payees that behave like fraud
mule accounts: sudden first-time money from many unrelated households, new
accounts, money moved straight back out, and overlap with confirmed scams.

Design rules (see docs/INVARIANTS.md and docs/adr/0005-abuse-ring-sentinel.md):

- INV-11: this module only *raises* caution. It returns a signal level; the
  policy engine combines it with hard rules and can never lower a rule's
  decision because of it.
- INV-13: reasons are fixed templates with numeric buckets. They describe the
  payee's pattern and never identify, name or count specific other customers.
- INV-14: this module reports what it sees, even for registered caregivers.
  The policy engine caps network-only signals at REVIEW for payees the owner
  registered as household employees. The output marks every signal as
  network-only so the cap can be applied.
- INV-05: amounts are integers in minor units.

Pure functions, no I/O: the same inputs always give the same output (INV-16).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import IntEnum

SENTINEL_VERSION = "sentinel-1.0.0"


class Level(IntEnum):
    """Ordered so that max() picks the more cautious level."""

    NONE = 0
    ELEVATED = 1
    HIGH = 2


@dataclass(frozen=True)
class Payment:
    payer_id: str
    household_id: str
    payee_id: str
    amount_minor: int
    currency: str
    at: datetime


@dataclass(frozen=True)
class Outflow:
    """Money leaving a payee's account (PayPal-side network view)."""

    payee_id: str
    amount_minor: int
    currency: str
    at: datetime


@dataclass(frozen=True)
class PayeeProfile:
    payee_id: str
    account_created_at: datetime


@dataclass(frozen=True)
class Thresholds:
    window: timedelta = timedelta(hours=72)
    outflow_window: timedelta = timedelta(hours=24)
    fraud_lookback: timedelta = timedelta(days=30)
    elevated_households: int = 3
    high_households: int = 5
    young_account: timedelta = timedelta(days=30)
    very_young_account: timedelta = timedelta(days=7)
    rapid_outflow_ratio: float = 0.8
    high_co_victim_overlap: int = 2


@dataclass(frozen=True)
class Features:
    new_households: int
    account_age: timedelta
    inflow_minor: int
    rapid_outflow_ratio: float
    co_victim_overlap: int


@dataclass(frozen=True)
class Assessment:
    payee_id: str
    level: Level
    reason_codes: tuple[str, ...]
    reasons: tuple[str, ...]
    features: Features
    network_only: bool = True
    version: str = SENTINEL_VERSION


# Fixed reason templates (INV-13). Only these strings can reach a person.
REASON_TEMPLATES: dict[str, str] = {
    "FAN_IN_3_4": "This payee recently received first-time payments from 3 to 4 unrelated accounts.",
    "FAN_IN_5_9": "This payee recently received first-time payments from 5 to 9 unrelated accounts.",
    "FAN_IN_10_PLUS": "This payee recently received first-time payments from 10 or more unrelated accounts.",
    "ACCOUNT_UNDER_WEEK": "This payee's account is less than a week old.",
    "ACCOUNT_UNDER_MONTH": "This payee's account is less than a month old.",
    "RAPID_OUTFLOW": "Most of the money this payee received was moved out again within a day.",
    "CO_VICTIM_OVERLAP": "Accounts paying this payee also recently paid a confirmed scam.",
}


def _fan_in_code(n: int) -> str | None:
    if n >= 10:
        return "FAN_IN_10_PLUS"
    if n >= 5:
        return "FAN_IN_5_9"
    if n >= 3:
        return "FAN_IN_3_4"
    return None


def compute_features(
    payee: PayeeProfile,
    payments: list[Payment],
    outflows: list[Outflow],
    confirmed_fraud_payees: frozenset[str],
    as_of: datetime,
    t: Thresholds = Thresholds(),
) -> Features:
    window_start = as_of - t.window

    # First payment ever from each household to this payee.
    first_seen: dict[str, datetime] = {}
    for p in payments:
        if p.payee_id != payee.payee_id or p.at > as_of:
            continue
        prev = first_seen.get(p.household_id)
        if prev is None or p.at < prev:
            first_seen[p.household_id] = p.at
    new_households = {h for h, at in first_seen.items() if at >= window_start}

    inflow_payments = [
        p
        for p in payments
        if p.payee_id == payee.payee_id and window_start <= p.at <= as_of
    ]
    inflow = sum(p.amount_minor for p in inflow_payments)

    # Money moved out within outflow_window of arriving.
    if inflow_payments:
        earliest_inflow = min(p.at for p in inflow_payments)
        out = sum(
            o.amount_minor
            for o in outflows
            if o.payee_id == payee.payee_id
            and earliest_inflow <= o.at <= as_of
            and o.at <= max(p.at for p in inflow_payments) + t.outflow_window
        )
    else:
        out = 0
    ratio = (out / inflow) if inflow > 0 else 0.0

    # Households new to this payee that also paid a confirmed scam recently.
    fraud_start = as_of - t.fraud_lookback
    fraud_households = {
        p.household_id
        for p in payments
        if p.payee_id in confirmed_fraud_payees
        and p.payee_id != payee.payee_id
        and fraud_start <= p.at <= as_of
    }
    overlap = len(new_households & fraud_households)

    return Features(
        new_households=len(new_households),
        account_age=as_of - payee.account_created_at,
        inflow_minor=inflow,
        rapid_outflow_ratio=round(ratio, 4),
        co_victim_overlap=overlap,
    )


def assess(
    payee: PayeeProfile,
    payments: list[Payment],
    outflows: list[Outflow],
    confirmed_fraud_payees: frozenset[str],
    as_of: datetime,
    t: Thresholds = Thresholds(),
) -> Assessment:
    f = compute_features(payee, payments, outflows, confirmed_fraud_payees, as_of, t)
    codes: list[str] = []
    level = Level.NONE

    fan_in = _fan_in_code(f.new_households)
    young = f.account_age < t.young_account
    very_young = f.account_age < t.very_young_account
    rapid = f.rapid_outflow_ratio >= t.rapid_outflow_ratio and f.new_households >= 2

    if fan_in:
        codes.append(fan_in)
    if very_young:
        codes.append("ACCOUNT_UNDER_WEEK")
    elif young:
        codes.append("ACCOUNT_UNDER_MONTH")
    if rapid:
        codes.append("RAPID_OUTFLOW")
    if f.co_victim_overlap >= 1:
        codes.append("CO_VICTIM_OVERLAP")

    if f.new_households >= t.elevated_households or (very_young and f.new_households >= 2):
        level = max(level, Level.ELEVATED)
    if (
        (f.new_households >= t.high_households and young)
        or f.co_victim_overlap >= t.high_co_victim_overlap
        or (f.new_households >= t.elevated_households and rapid)
    ):
        level = max(level, Level.HIGH)

    # Account age alone is not a signal; keep its reason only alongside others.
    if level == Level.NONE:
        codes = []

    return Assessment(
        payee_id=payee.payee_id,
        level=level,
        reason_codes=tuple(codes),
        reasons=tuple(REASON_TEMPLATES[c] for c in codes),
        features=f,
    )
