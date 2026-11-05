"""Synthetic payment histories with injected scams, driven by calibration.yaml.

Every generated row carries `synthetic=True`. Scam rows also carry their
scam type so evaluation can report recall per type. Hard negatives
(legitimate new payees, legitimate large payments) are included on purpose:
a model that only learns "new payee = scam" would hold real people's bills.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

CALIBRATION_PATH = Path(__file__).resolve().parents[2] / "data" / "calibration.yaml"
DAY = 86_400


def load_calibration(path: Path = CALIBRATION_PATH) -> dict[str, Any]:
    with path.open() as f:
        data: dict[str, Any] = yaml.safe_load(f)
    return data


@dataclass(frozen=True)
class Txn:
    owner_id: str
    payee_id: str
    amount_minor: int
    at: int  # unix seconds, UTC
    hour_local: int
    method: str
    text_labels: tuple[str, ...]
    is_scam: bool
    scam_type: str | None = None
    hard_negative: str | None = None
    synthetic: bool = True
    # False for payments kept only as history (recent, outcome not known yet): never trained or scored on.
    train_row: bool = True


@dataclass
class Dataset:
    txns: list[Txn] = field(default_factory=list)


def _lognormal_minor(rng: random.Random, median_usd: float, sigma: float) -> int:
    return max(100, int(round(math.exp(math.log(median_usd) + sigma * rng.gauss(0, 1)) * 100)))


def _pick(rng: random.Random, weights: dict[str, float]) -> str:
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys], k=1)[0]


def generate(n_owners: int = 2000, months: int = 6, scam_share: float = 0.25, seed: int = 11) -> Dataset:
    cal = load_calibration()
    rng = random.Random(seed)
    normal = cal["normal_interim"]
    ds = Dataset()
    start = 1_767_225_600  # 2026-01-01T00:00:00Z

    scam_weights = {k: v["weight"] for k, v in cal["scam_types"].items()}
    method_weights: dict[str, float] = cal["payment_methods_70_plus"]

    for o in range(n_owners):
        owner = f"owner_{o:04d}"
        payees = [f"{owner}_payee_{i}" for i in range(rng.randint(*normal["payees_per_owner"]))]
        payee_median = {p: normal["amount_median_usd"] * math.exp(rng.gauss(0, 0.6)) for p in payees}
        end = start + months * 30 * DAY

        t = start
        while t < end:
            t += int(rng.expovariate(rng.uniform(*normal["payments_per_month"]) / (30 * DAY)))
            if t >= end:
                break
            hour = rng.choice(range(8, 21))
            r = rng.random()
            if r < normal["legit_new_payee_share"]:
                p = f"{owner}_newlegit_{t}"
                amt = _lognormal_minor(rng, normal["amount_median_usd"] * 2, normal["amount_sigma"])
                ds.txns.append(Txn(owner, p, amt, t, hour, "p2p", (), False, hard_negative="new_payee"))
                payees.append(p)
                payee_median[p] = amt / 100
            elif r < normal["legit_new_payee_share"] + normal["legit_large_payment_share"]:
                p = rng.choice(payees)
                amt = _lognormal_minor(rng, payee_median[p] * 8, 0.5)
                ds.txns.append(Txn(owner, p, amt, t, hour, "bank_transfer", (), False, hard_negative="large_payment"))
            else:
                p = rng.choice(payees)
                amt = _lognormal_minor(rng, payee_median[p], 0.35)
                method = _pick(rng, normal["methods"])
                labels = tuple(l for l, rate in normal["note_label_rates"].items() if rng.random() < rate)
                ds.txns.append(Txn(owner, p, amt, t, hour, method, labels, False))

        if rng.random() < scam_share:
            stype = _pick(rng, scam_weights)
            spec = cal["scam_types"][stype]
            sa = cal["scam_amount_usd"]
            scammer = f"scammer_{stype}_{o}"
            t = rng.randint(start + 60 * DAY, end - 10 * DAY)
            if spec["grooming"]:
                # Small trust-building payments weeks earlier: by the time the large
                # payments come, the scammer is a payee the owner already knows.
                g = t - rng.randint(25, 50) * DAY
                for _ in range(rng.randint(1, 3)):
                    amt = _lognormal_minor(rng, normal["amount_median_usd"] * 0.6, 0.4)
                    ds.txns.append(Txn(owner, scammer, amt, g, rng.choice(range(9, 20)), "p2p", (), True, scam_type=f"{stype}_grooming"))
                    g += rng.randint(2, 8) * DAY
            for _ in range(rng.randint(*sa["payments_per_victim"])):
                daytime = rng.random() < cal["scam_timing"]["daytime_share"]
                hour = rng.choice(range(9, 18)) if daytime else rng.choice([0, 1, 2, 3, 4, 5, 6, 7, 19, 20, 21, 22, 23])
                method = spec["method_bias"] if rng.random() < 0.6 else _pick(rng, method_weights)
                # Scammers often use plain-looking notes; labels appear only some of the time.
                labels = tuple(spec["labels"]) if rng.random() < 0.55 else ()
                amt = _lognormal_minor(rng, sa["per_payment_median"] * spec["amount_scale"], sa["per_payment_sigma"])
                ds.txns.append(Txn(owner, scammer, amt, t, hour, method, labels, True, scam_type=stype))
                t += rng.randint(3600, 3 * DAY)

    ds.txns.sort(key=lambda x: (x.owner_id, x.at))
    return ds
