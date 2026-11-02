"""Deterministic synthetic scenarios for the abuse-ring sentinel.

All data here is synthetic and labelled as such. It is built to show two
things side by side: a fraud ring being caught, and a legitimate caregiver who
works for several households *not* being treated as one.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .sentinel import Outflow, PayeeProfile, Payment

AS_OF = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


@dataclass(frozen=True)
class Scenario:
    payments: list[Payment]
    outflows: list[Outflow]
    payees: dict[str, PayeeProfile]
    confirmed_fraud_payees: frozenset[str]
    registered_caregivers: dict[str, frozenset[str]]  # payee_id -> households that registered them
    as_of: datetime = AS_OF


def build(seed: int = 7) -> Scenario:
    rng = random.Random(seed)
    payments: list[Payment] = []
    outflows: list[Outflow] = []
    payees: dict[str, PayeeProfile] = {}
    households = [f"hh_{i:03d}" for i in range(40)]

    def add_payee(pid: str, age_days: int) -> None:
        payees[pid] = PayeeProfile(pid, AS_OF - timedelta(days=age_days))

    # Everyday payees every household has paid for months (utilities, family).
    for pid in ("utility_power", "pharmacy_main", "grocer_local"):
        add_payee(pid, 3000)
    for h in households:
        for pid in ("utility_power", "pharmacy_main", "grocer_local"):
            for months_ago in range(1, 7):
                payments.append(
                    Payment(
                        f"{h}_owner", h, pid,
                        rng.randint(2_000, 15_000), "USD",
                        AS_OF - timedelta(days=30 * months_ago + rng.randint(0, 5)),
                    )
                )

    # Ring: a 3-day-old mule collects first-time "tech support" payments from
    # 8 households over 48 hours and moves almost all of it out within a day.
    add_payee("mule_alpha", 3)
    ring_households = rng.sample(households, 8)
    for i, h in enumerate(ring_households):
        payments.append(
            Payment(f"{h}_owner", h, "mule_alpha", rng.randint(40_000, 120_000), "USD",
                    AS_OF - timedelta(hours=48 - i * 5))
        )
    inflow = sum(p.amount_minor for p in payments if p.payee_id == "mule_alpha")
    outflows.append(Outflow("mule_alpha", int(inflow * 0.93), "USD", AS_OF - timedelta(hours=2)))

    # A previously confirmed scam payee that two of the ring's victims paid
    # earlier this month: the co-victim link.
    add_payee("scam_confirmed_01", 40)
    for h in ring_households[:2]:
        payments.append(
            Payment(f"{h}_owner", h, "scam_confirmed_01", 25_000, "USD", AS_OF - timedelta(days=12))
        )

    # Legitimate caregiver: new to PayPal (10-day-old account), started with
    # 5 households this week. Looks like a ring to a naive detector.
    add_payee("caregiver_maria", 10)
    care_households = [h for h in households if h not in ring_households][:5]
    for i, h in enumerate(care_households):
        payments.append(
            Payment(f"{h}_owner", h, "caregiver_maria", 32_000, "USD",
                    AS_OF - timedelta(hours=60 - i * 10))
        )

    return Scenario(
        payments=payments,
        outflows=outflows,
        payees=payees,
        confirmed_fraud_payees=frozenset({"scam_confirmed_01"}),
        registered_caregivers={"caregiver_maria": frozenset(care_households)},
    )
