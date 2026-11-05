"""The promotion gate: a retrained model replaces the running one only if it
is at least as protective, and a person says yes.

    python -m risk.promote --candidate artifacts/candidate --real outcomes.jsonl
    python -m risk.promote --candidate artifacts/candidate --real outcomes.jsonl --approve

Checks, all of which must pass (INV-28):

1. Every confirmed real scam the current model catches, the candidate catches
   too. Learning may add catches; it may never drop one.
2. On a fixed synthetic test set, the candidate catches at least as many scams
   (within half a point) as the current model.
3. It doesn't hold more normal payments: at most a quarter of a point more
   than the current model on the synthetic set, and never over 1%; on real
   payments people said were fine, at most half a point more.
4. More scam words can never lower its score (checked directly).

The report is written to reports/promotion-<version>.json either way. With
--approve and every check passed, the current model is kept in
artifacts/previous/<version>/ (one command to roll back) and the candidate
takes its place. Without --approve nothing changes.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np

from .features import TEXT_LABELS, Payment, compute_for_sorted
from .model import Artifacts, level_for, load
from .real import combine, load_real
from .synth import Dataset, Txn, generate

ROOT = Path(__file__).resolve().parents[2]
GATE_SEED = 20261105  # fixed, so every candidate faces the same exam


def levels(art: Artifacts, ds: Dataset) -> list[str]:
    rows = [(Payment(t.payee_id, t.amount_minor, t.at, t.hour_local, t.method, t.text_labels), t.owner_id) for t in ds.txns]
    x = np.asarray(compute_for_sorted(rows, art.text_labels), dtype=np.float64)
    p = art.booster.predict(x)
    a = -art.iforest.score_samples(x)
    return [level_for(pi, ai, art.thresholds) for pi, ai in zip(p, a)]


def _rates(lv: list[str], txns: list[Txn]) -> dict[str, float]:
    scam = [i for i, t in enumerate(txns) if t.is_scam and t.train_row and not (t.scam_type or "").endswith("_grooming")]
    normal = [i for i, t in enumerate(txns) if not t.is_scam and t.train_row]
    return {
        "scam_flagged": sum(lv[i] != "PASS" for i in scam) / max(1, len(scam)),
        "normal_held": sum(lv[i] == "HOLD" for i in normal) / max(1, len(normal)),
        "n_scam": len(scam),
        "n_normal": len(normal),
    }


def monotone_in_words(art: Artifacts) -> bool:
    """Adding scam words to the same payment never lowers the probability."""
    rng = np.random.default_rng(GATE_SEED)
    words_feature = 8
    for _ in range(300):
        base = [
            float(np.log1p(rng.integers(100, 2_000_000))),
            float(rng.uniform(0.1, 30)),
            float(rng.integers(0, 2)),
            float(rng.uniform(-1, 400)),
            float(rng.integers(0, 6)),
            float(rng.uniform(0.1, 40)),
            float(rng.integers(0, 24)),
            float(rng.integers(0, 4)),
            0.0,
        ]
        probs = []
        for k in range(len(art.text_labels) + 1):
            row = list(base)
            row[words_feature] = float(k)
            probs.append(float(art.booster.predict(np.asarray([row]))[0]))
        if any(b < a - 1e-12 for a, b in zip(probs, probs[1:])):
            return False
    return True


def gate(current: Artifacts, candidate: Artifacts, real: list[Txn]) -> dict[str, Any]:
    synth = generate(n_owners=800, seed=GATE_SEED)
    s_cur, s_cand = _rates(levels(current, synth), synth.txns), _rates(levels(candidate, synth), synth.txns)

    checks: dict[str, Any] = {}
    if real:
        ds = combine(Dataset(), real)
        lc, ln = levels(current, ds), levels(candidate, ds)
        scams = [i for i, t in enumerate(ds.txns) if t.is_scam]
        dropped = [i for i in scams if lc[i] != "PASS" and ln[i] == "PASS"]
        fine = [i for i, t in enumerate(ds.txns) if not t.is_scam and t.train_row]
        held_cur = sum(lc[i] == "HOLD" for i in fine) / max(1, len(fine))
        held_new = sum(ln[i] == "HOLD" for i in fine) / max(1, len(fine))
        checks["keeps_every_real_scam_it_caught"] = {
            "pass": not dropped,
            "real_scams": len(scams),
            "current_caught": sum(lc[i] != "PASS" for i in scams),
            "candidate_caught": sum(ln[i] != "PASS" for i in scams),
            "dropped": len(dropped),
        }
        checks["real_fine_payments_not_held_more"] = {"pass": held_new <= held_cur + 0.005, "current": round(held_cur, 4), "candidate": round(held_new, 4)}
    checks["catches_as_many_synthetic_scams"] = {
        "pass": s_cand["scam_flagged"] >= s_cur["scam_flagged"] - 0.005,
        "current": round(s_cur["scam_flagged"], 4),
        "candidate": round(s_cand["scam_flagged"], 4),
    }
    checks["holds_no_more_normal_payments"] = {
        "pass": s_cand["normal_held"] <= min(s_cur["normal_held"] + 0.0025, 0.01),
        "current": round(s_cur["normal_held"], 4),
        "candidate": round(s_cand["normal_held"], 4),
    }
    checks["more_scam_words_never_lower_the_score"] = {"pass": monotone_in_words(candidate)}
    checks["knows_at_least_the_original_words"] = {"pass": set(TEXT_LABELS) <= set(candidate.text_labels), "words": list(candidate.text_labels)}
    return {
        "current": current.version,
        "candidate": candidate.version,
        "passed": all(c["pass"] for c in checks.values()),
        "checks": checks,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", type=Path, required=True)
    ap.add_argument("--current", type=Path, default=ROOT / "artifacts")
    ap.add_argument("--real", type=Path)
    ap.add_argument("--approve", action="store_true", help="replace the running model if every check passes")
    a = ap.parse_args(argv)

    current, candidate = load(a.current), load(a.candidate)
    report = gate(current, candidate, load_real(a.real) if a.real else [])
    # Next to the models it judged: the service's reports/ for the real ones, a test's own folder for tests.
    reports = ROOT / "reports" if a.current.resolve() == (ROOT / "artifacts").resolve() else a.current.parent / "reports"
    reports.mkdir(exist_ok=True)
    (reports / f"promotion-{candidate.version}.json").write_text(json.dumps(report, indent=2, sort_keys=True))
    for name, c in report["checks"].items():
        print(f"  {'PASS' if c['pass'] else 'FAIL'}  {name}  {json.dumps({k: v for k, v in c.items() if k != 'pass'})}")
    if not report["passed"]:
        print(f"Candidate {candidate.version} is NOT promoted.")
        return 1
    if not a.approve:
        print(f"Candidate {candidate.version} passed. Re-run with --approve to put it live.")
        return 0
    keep = a.current / "previous" / current.version
    keep.mkdir(parents=True, exist_ok=True)
    for f in ("model.txt", "iforest.joblib", "meta.json"):
        shutil.copy2(a.current / f, keep / f)
        shutil.copy2(a.candidate / f, a.current / f)
    print(f"Promoted {candidate.version}. Previous model kept in {keep}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
