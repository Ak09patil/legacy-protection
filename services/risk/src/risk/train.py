"""Train, evaluate and save the risk model.

    python -m risk.train                                   # synthetic only -> artifacts/
    python -m risk.train --real outcomes.jsonl --out artifacts/candidate

A model trained on real outcomes is only a candidate. It replaces the running
model after it passes the promotion gate and a person approves it:

    python -m risk.promote --candidate artifacts/candidate --real outcomes.jsonl [--approve]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .model import save, train
from .real import combine, load_real
from .synth import generate

ROOT = Path(__file__).resolve().parents[2]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", type=Path, help="real outcomes exported from the app (JSONL)")
    ap.add_argument("--out", type=Path, default=ROOT / "artifacts")
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args(argv)

    ds = generate(seed=a.seed)
    if a.real:
        real = load_real(a.real)
        ds = combine(ds, real)
        print(f"real rows: {len(real)} ({sum(t.is_scam for t in real)} confirmed scams)")
    art = train(ds, seed=a.seed)
    save(art, a.out)
    if a.out == ROOT / "artifacts":
        reports = ROOT / "reports"
        reports.mkdir(exist_ok=True)
        (reports / "metrics.json").write_text(json.dumps({"version": art.version, **art.metrics}, indent=2, sort_keys=True))
    m = art.metrics
    print(f"model {art.version} -> {a.out}")
    print(f"  words it knows             {', '.join(art.text_labels)}")
    print(f"  ROC AUC                    {m['roc_auc']}")
    print(f"  scam payments flagged      {m['scam_flagged_rate']:.1%}")
    print(f"  scam payments held         {m['scam_held_rate']:.1%}")
    print(f"  normal payments held       {m['normal_false_hold_rate']:.2%}")
    print(f"  normal payments reviewed   {m['normal_false_flag_rate']:.2%}")


if __name__ == "__main__":
    main()
