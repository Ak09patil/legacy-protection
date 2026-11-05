"""Training, thresholds and explanations for the transaction risk model.

- LightGBM classifier; SHAP TreeExplainer for per-decision reasons (INV-12).
- IsolationForest trained on normal payments only, for "doesn't look like you".
- Thresholds are set on held-out NORMAL payments, so the false-hold rate is a
  number we choose and report, not an accident.
- Reasons are fixed templates (INV-13): a model can only point at a feature,
  never write its own text.
"""

from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import shap
import warnings
from sklearn.ensemble import IsolationForest

from .features import FEATURE_NAMES, TEXT_LABELS, Payment, compute_for_sorted
from .synth import Dataset, Txn, generate

MODEL_FAMILY = "risk-lgbm"
REAL_WEIGHT = 5.0

# Feature -> (reason code, plain-language text). Only these can reach a person.
REASONS: dict[str, tuple[str, str]] = {
    "log_amount": ("LARGE_AMOUNT", "This is a large payment."),
    "amount_ratio_to_typical": ("UNUSUAL_AMOUNT", "This payment is much larger than your usual payments."),
    "payee_is_new": ("NEW_PAYEE", "You haven't paid this person before."),
    "days_since_payee_first_seen": ("NEW_PAYEE", "You haven't paid this person before."),
    "payments_last_24h": ("RAPID_PAYMENTS", "Several payments have gone out in a short time."),
    "amount_last_72h_ratio": ("RAPID_PAYMENTS", "A lot of money has gone out in the last few days."),
    "hour_local": ("UNUSUAL_TIME", "This payment was made at an unusual time of day for you."),
    "method_code": ("RISKY_METHOD", "This payment method is one scammers often ask for."),
    "text_scam_label_count": ("SCAM_LANGUAGE", "The payment note uses language common in scams."),
}
ANOMALY_REASON = ("UNLIKE_YOU", "This payment doesn't look like your usual activity.")


@dataclass(frozen=True)
class Thresholds:
    review: float
    hold: float
    anomaly: float


@dataclass
class Artifacts:
    booster: lgb.Booster
    iforest: IsolationForest
    thresholds: Thresholds
    version: str
    metrics: dict[str, Any]
    # The text labels this model counts. Labels outside it are ignored, never an error.
    text_labels: tuple[str, ...] = TEXT_LABELS


def vocabulary_for(ds: Dataset) -> tuple[str, ...]:
    """The original labels, plus any new label seen on a confirmed real outcome."""
    seen = {label for t in ds.txns if not t.synthetic for label in t.text_labels}
    return TEXT_LABELS + tuple(sorted(seen - set(TEXT_LABELS)))


def to_xy(ds: Dataset, vocabulary: tuple[str, ...] = TEXT_LABELS) -> tuple[np.ndarray, np.ndarray, list[Txn]]:
    rows = [
        (Payment(t.payee_id, t.amount_minor, t.at, t.hour_local, t.method, t.text_labels), t.owner_id)
        for t in ds.txns
    ]
    x = np.asarray(compute_for_sorted(rows, vocabulary), dtype=np.float64)
    y = np.asarray([1 if t.is_scam else 0 for t in ds.txns], dtype=np.int32)
    return x, y, ds.txns


def _split_by_owner(txns: list[Txn], seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    owners = sorted({t.owner_id for t in txns})
    random.Random(seed).shuffle(owners)
    n = len(owners)
    train_o = set(owners[: int(n * 0.6)])
    val_o = set(owners[int(n * 0.6) : int(n * 0.8)])
    idx = np.arange(len(txns))
    train = idx[[t.owner_id in train_o for t in txns]]
    val = idx[[t.owner_id in val_o for t in txns]]
    test = idx[[t.owner_id not in train_o and t.owner_id not in val_o for t in txns]]
    return train, val, test


def train(
    ds: Dataset | None = None,
    seed: int = 11,
    target_false_hold: float = 0.005,
    target_false_review: float = 0.03,
) -> Artifacts:
    ds = ds or generate(seed=seed)
    vocabulary = vocabulary_for(ds)
    x, y, txns = to_xy(ds, vocabulary)
    tr, va, te = _split_by_owner(txns, seed)
    # Grooming payments are scam money but look exactly like normal small payments
    # when they happen. Training on them would teach "small new payee = scam".
    # Excluded from training; reported separately in evaluation.
    grooming = np.asarray([bool(t.scam_type and t.scam_type.endswith("_grooming")) or not t.train_row for t in txns], dtype=bool)
    tr, va = tr[~grooming[tr]], va[~grooming[va]]

    params = {
        "objective": "binary",
        "learning_rate": 0.05,
        "num_leaves": 15,
        "min_data_in_leaf": 40,
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "seed": seed,
        "deterministic": True,
        "verbose": -1,
        # More scam words can only raise the score, never lower it, whatever the model learns (INV-11).
        "monotone_constraints": [1 if f == "text_scam_label_count" else 0 for f in FEATURE_NAMES],
        "monotone_constraints_method": "advanced",
    }
    # Real, confirmed outcomes count for more than synthetic ones: they are what actually happened.
    weight = np.asarray([1.0 if t.synthetic else REAL_WEIGHT for t in txns])
    booster = lgb.train(
        params,
        lgb.Dataset(x[tr], y[tr], weight=weight[tr], feature_name=list(FEATURE_NAMES)),
        num_boost_round=300,
        valid_sets=[lgb.Dataset(x[va], y[va], feature_name=list(FEATURE_NAMES))],
        callbacks=[lgb.early_stopping(30, verbose=False)],
    )

    normal_tr = tr[y[tr] == 0]
    iforest = IsolationForest(n_estimators=200, contamination="auto", random_state=seed).fit(x[normal_tr])

    # Thresholds from held-out normal payments: a chosen false-hold rate.
    p_val_normal = booster.predict(x[va][y[va] == 0])
    hold = float(np.quantile(p_val_normal, 1 - target_false_hold))
    review = float(np.quantile(p_val_normal, 1 - target_false_review))
    anom_val_normal = -iforest.score_samples(x[va][y[va] == 0])
    anomaly = float(np.quantile(anom_val_normal, 0.995))
    th = Thresholds(review=min(review, hold), hold=hold, anomaly=anomaly)

    te = te[np.asarray([txns[i].train_row for i in te], dtype=bool)]
    metrics = evaluate(booster, iforest, th, x[te], y[te], [txns[i] for i in te])
    version = _version(params, seed, booster)
    return Artifacts(booster, iforest, th, version, metrics, vocabulary)


def _version(params: dict[str, Any], seed: int, booster: lgb.Booster) -> str:
    h = hashlib.sha256()
    h.update(json.dumps(params, sort_keys=True).encode())
    h.update(str(seed).encode())
    h.update(booster.model_to_string().encode())
    return f"{MODEL_FAMILY}-{h.hexdigest()[:12]}"


def level_for(prob: float, anomaly_score: float, th: Thresholds) -> str:
    if prob >= th.hold:
        return "HOLD"
    if prob >= th.review or anomaly_score >= th.anomaly:
        return "REVIEW"
    return "PASS"


def evaluate(
    booster: lgb.Booster, iforest: IsolationForest, th: Thresholds, x: np.ndarray, y: np.ndarray, txns: list[Txn]
) -> dict[str, Any]:
    p = booster.predict(x)
    a = -iforest.score_samples(x)
    levels = np.asarray([level_for(pi, ai, th) for pi, ai in zip(p, a)])
    flagged = levels != "PASS"
    held = levels == "HOLD"
    grooming = np.asarray([bool(t.scam_type and t.scam_type.endswith("_grooming")) for t in txns], dtype=bool)
    normal = y == 0
    scam = (y == 1) & ~grooming

    def rate(mask: np.ndarray, sel: np.ndarray) -> float:
        return float(sel[mask].mean()) if mask.any() else float("nan")

    per_type = {}
    for stype in sorted({t.scam_type for t in txns if t.scam_type}):
        m = np.asarray([t.scam_type == stype for t in txns])
        per_type[stype] = {"n": int(m.sum()), "flagged": round(rate(m, flagged), 4)}

    hard = {}
    for kind in ("new_payee", "large_payment"):
        m = np.asarray([t.hard_negative == kind for t in txns])
        hard[kind] = {"n": int(m.sum()), "false_hold": round(rate(m, held), 4), "false_flag": round(rate(m, flagged), 4)}

    from sklearn.metrics import roc_auc_score

    return {
        "data": "synthetic (calibration.yaml); normals are interim until DCPC data is loaded",
        "test_payments": int(len(y)),
        "test_scam_payments": int(scam.sum()),
        "test_grooming_payments": int(grooming.sum()),
        "roc_auc": round(float(roc_auc_score(y[~grooming], p[~grooming])), 4),
        "note": "Grooming payments (small trust-building payments before a scam) are excluded from headline metrics and shown per type.",
        "scam_flagged_rate": round(rate(scam, flagged), 4),
        "scam_held_rate": round(rate(scam, held), 4),
        "normal_false_hold_rate": round(rate(normal, held), 4),
        "normal_false_flag_rate": round(rate(normal, flagged), 4),
        "per_scam_type": per_type,
        "hard_negatives": hard,
        "thresholds": {"review": th.review, "hold": th.hold, "anomaly": th.anomaly},
    }


class Explainer:
    def __init__(self, art: Artifacts) -> None:
        self.art = art
        self._shap = shap.TreeExplainer(art.booster)
        warnings.filterwarnings("ignore", message="LightGBM binary classifier with TreeExplainer")

    def score(self, features: list[float]) -> dict[str, Any]:
        x = np.asarray([features], dtype=np.float64)
        prob = float(self.art.booster.predict(x)[0])
        anomaly = float(-self.art.iforest.score_samples(x)[0])
        level = level_for(prob, anomaly, self.art.thresholds)
        reasons: list[dict[str, str]] = []
        if level != "PASS":
            contrib = np.asarray(self._shap.shap_values(x)).reshape(-1)[: len(FEATURE_NAMES)]
            order = np.argsort(-contrib)
            seen: set[str] = set()
            for i in order:
                if contrib[i] <= 0 or len(reasons) >= 2:
                    break
                code, text = REASONS[FEATURE_NAMES[i]]
                if code not in seen:
                    seen.add(code)
                    reasons.append({"code": code, "text": text, "source": "MODEL"})
            if not reasons and anomaly >= self.art.thresholds.anomaly:
                reasons.append({"code": ANOMALY_REASON[0], "text": ANOMALY_REASON[1], "source": "MODEL"})
            if not reasons:  # INV-12: never a hold without a reason
                reasons.append({"code": "UNEXPLAINED", "text": "This payment needs a second look before it goes out.", "source": "MODEL"})
        return {
            "level": level,
            "reasons": reasons,
            "networkOnly": False,
            "modelVersion": self.art.version,
            "probability": round(prob, 6),
        }


def save(art: Artifacts, directory: Path) -> None:
    import joblib

    directory.mkdir(parents=True, exist_ok=True)
    art.booster.save_model(str(directory / "model.txt"))
    joblib.dump(art.iforest, directory / "iforest.joblib")
    (directory / "meta.json").write_text(
        json.dumps(
            {"version": art.version, "thresholds": art.thresholds.__dict__, "metrics": art.metrics, "text_labels": list(art.text_labels)},
            indent=2,
            sort_keys=True,
        )
    )


def load(directory: Path) -> Artifacts:
    import joblib

    meta = json.loads((directory / "meta.json").read_text())
    return Artifacts(
        booster=lgb.Booster(model_file=str(directory / "model.txt")),
        iforest=joblib.load(directory / "iforest.joblib"),
        thresholds=Thresholds(**meta["thresholds"]),
        version=meta["version"],
        metrics=meta["metrics"],
        text_labels=tuple(meta.get("text_labels", TEXT_LABELS)),
    )
