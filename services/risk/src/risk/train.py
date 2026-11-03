"""Train, evaluate and save the risk model.

    python -m risk.train            # writes artifacts/ and reports/metrics.json
"""

from __future__ import annotations

import json
from pathlib import Path

from .model import save, train

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    art = train()
    save(art, ROOT / "artifacts")
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    (reports / "metrics.json").write_text(json.dumps({"version": art.version, **art.metrics}, indent=2, sort_keys=True))
    m = art.metrics
    print(f"model {art.version}")
    print(f"  ROC AUC                    {m['roc_auc']}")
    print(f"  scam payments flagged      {m['scam_flagged_rate']:.1%}")
    print(f"  scam payments held         {m['scam_held_rate']:.1%}")
    print(f"  normal payments held       {m['normal_false_hold_rate']:.2%}")
    print(f"  normal payments reviewed   {m['normal_false_flag_rate']:.2%}")


if __name__ == "__main__":
    main()
