"""The learning loop: real outcomes make the model smarter, and the gate stops
a worse model from going live (INV-28).

"Real" outcomes here are generated stand-ins, written in the exact format the
app exports, with a scam pattern the synthetic training data doesn't contain.
"""

from __future__ import annotations

import json
import random
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from risk.model import Thresholds, load, save, train
from risk.promote import gate
from risk.real import combine, load_real
from risk.synth import Dataset, generate

T0 = datetime(2026, 3, 1, tzinfo=timezone.utc)


def fake_real_outcomes(n_owners: int, seed: int) -> list[dict]:
    """Households with ordinary bills, some of whom meet a 'trading mentor'.

    The scam payments are modest, by p2p, labelled INVESTMENT_PITCH (a word the
    first model has never seen), and sent mid-evening: a pattern the synthetic
    data doesn't teach.
    """
    rng = random.Random(seed)
    rows: list[dict] = []
    for o in range(n_owners):
        owner = f"h:owner{seed}-{o}"
        for m in range(6):
            for payee, amt in (("h:rent", 120_000), ("h:grocer", 9_000 + rng.randint(0, 4000)), ("h:pharmacy", 4_200)):
                at = T0 + timedelta(days=30 * m + rng.randint(0, 25), hours=rng.randint(9, 17))
                rows.append({"owner": owner, "payee": payee, "amountMinor": amt, "at": at.isoformat(), "hourLocal": at.hour, "method": "p2p", "textLabels": [], "outcome": "MATURED"})
        if o % 3 == 0:  # a third of them are being groomed
            mentor = f"h:mentor{seed}-{o}"
            for k, amt in enumerate((20_000, 45_000, 90_000, 140_000)):
                at = T0 + timedelta(days=120 + 9 * k, hours=20)
                rows.append({"owner": owner, "payee": mentor, "amountMinor": amt, "at": at.isoformat(), "hourLocal": 20, "method": "p2p", "textLabels": ["INVESTMENT_PITCH"], "outcome": "SCAM"})
    return rows


def write(rows: list[dict], path: Path) -> Path:
    path.write_text("\n".join(json.dumps(r) for r in rows))
    return path


@pytest.fixture(scope="module")
def models(tmp_path_factory: pytest.TempPathFactory) -> dict:
    d = tmp_path_factory.mktemp("learn")
    base = generate(n_owners=500, seed=3)
    current = train(base, seed=3)
    train_rows = write(fake_real_outcomes(300, seed=1), d / "train.jsonl")
    holdout_rows = write(fake_real_outcomes(120, seed=2), d / "holdout.jsonl")
    candidate = train(combine(base, load_real(train_rows)), seed=3)
    return {"current": current, "candidate": candidate, "holdout": load_real(holdout_rows), "dir": d}


def caught(art, txns) -> float:
    from risk.promote import levels

    ds = combine(Dataset(), txns)
    lv = levels(art, ds)
    scams = [i for i, t in enumerate(ds.txns) if t.is_scam]
    return sum(lv[i] != "PASS" for i in scams) / len(scams)


def test_INV28_real_outcomes_teach_a_pattern_the_model_never_saw(models: dict) -> None:
    before, after = caught(models["current"], models["holdout"]), caught(models["candidate"], models["holdout"])
    # Measured on households the candidate never trained on.
    assert after > before
    assert after >= 0.9


def test_INV28_new_scam_words_join_the_vocabulary_after_retraining(models: dict) -> None:
    assert "INVESTMENT_PITCH" not in models["current"].text_labels
    assert "INVESTMENT_PITCH" in models["candidate"].text_labels
    assert models["candidate"].text_labels[:6] == models["current"].text_labels[:6]


def test_INV28_the_gate_lets_a_better_model_through(models: dict) -> None:
    report = gate(models["current"], models["candidate"], models["holdout"])
    assert report["passed"], report


def test_INV28_the_gate_refuses_a_model_that_catches_less(models: dict) -> None:
    lazy = replace(models["candidate"], thresholds=Thresholds(review=0.999999, hold=0.9999999, anomaly=1e9))
    report = gate(models["current"], lazy, models["holdout"])
    assert not report["passed"]
    assert not report["checks"]["catches_as_many_synthetic_scams"]["pass"]


def test_INV28_the_gate_refuses_a_model_that_holds_ordinary_payments(models: dict) -> None:
    jumpy = replace(models["candidate"], thresholds=Thresholds(review=0.0, hold=0.0, anomaly=0.0))
    report = gate(models["current"], jumpy, models["holdout"])
    assert not report["checks"]["holds_no_more_normal_payments"]["pass"]
    assert not report["passed"]


def test_INV28_promotion_keeps_the_old_model_for_rollback(models: dict, tmp_path: Path) -> None:
    from risk.promote import main

    current_dir, cand_dir = tmp_path / "artifacts", tmp_path / "candidate"
    save(models["current"], current_dir)
    save(models["candidate"], cand_dir)
    real = write(fake_real_outcomes(60, seed=4), tmp_path / "real.jsonl")
    # Without --approve nothing changes.
    assert main(["--candidate", str(cand_dir), "--current", str(current_dir), "--real", str(real)]) == 0
    assert load(current_dir).version == models["current"].version
    assert main(["--candidate", str(cand_dir), "--current", str(current_dir), "--real", str(real), "--approve"]) == 0
    assert load(current_dir).version == models["candidate"].version
    assert load(current_dir / "previous" / models["current"].version).version == models["current"].version


def test_real_data_must_be_anonymous(tmp_path: Path) -> None:
    bad = [{"owner": "eleanor@example.com", "payee": "h:x", "amountMinor": 100, "at": T0.isoformat(), "hourLocal": 9, "method": "p2p", "textLabels": [], "outcome": "SCAM"}]
    with pytest.raises(ValueError, match="hashed"):
        load_real(write(bad, tmp_path / "bad.jsonl"))
