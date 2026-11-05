"""Real outcomes, exported from the app, as training rows.

The app exports one JSON line per payment that left an account (see
apps/web/scripts/export-outcomes.mts). There's no message text and no real
identities: owners and payees are keyed hashes, so the model learns patterns,
never people (INV-17, INV-21).

Labels come only from people who can know: the owner, their trusted person,
or our operations team. Never from a payee, so a scammer can't teach the
model that their own payments are fine.

    {"owner": "h:…", "payee": "h:…", "amountMinor": 50000, "at": "2026-10-01T10:00:00Z",
     "hourLocal": 10, "method": "p2p", "textLabels": ["INVESTMENT_PITCH"], "outcome": "SCAM"}

outcome is SCAM, NOT_SCAM, MATURED (sent 60+ days ago and never reported:
counted as normal), or PENDING (too recent to know: used only as history).
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from .features import METHODS
from .synth import Dataset, Txn

OUTCOMES = {"SCAM", "NOT_SCAM", "MATURED", "PENDING"}


def load_real(path: Path) -> list[Txn]:
    out: list[Txn] = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        r = json.loads(line)
        if r["outcome"] not in OUTCOMES or r["method"] not in METHODS:
            raise ValueError(f"line {n}: bad outcome or method")
        if not (str(r["owner"]).startswith("h:") and str(r["payee"]).startswith("h:")):
            raise ValueError(f"line {n}: identities must be hashed")
        out.append(
            Txn(
                owner_id=r["owner"],
                payee_id=r["payee"],
                amount_minor=int(r["amountMinor"]),
                at=int(datetime.fromisoformat(r["at"].replace("Z", "+00:00")).timestamp()),
                hour_local=int(r["hourLocal"]),
                method=r["method"],
                text_labels=tuple(r.get("textLabels", [])),
                is_scam=r["outcome"] == "SCAM",
                scam_type="real_confirmed" if r["outcome"] == "SCAM" else None,
                synthetic=False,
                train_row=r["outcome"] != "PENDING",
            )
        )
    return out


def combine(synthetic: Dataset, real: list[Txn]) -> Dataset:
    """Synthetic and real together, sorted by owner then time (features depend on order)."""
    txns = sorted([*synthetic.txns, *real], key=lambda t: (t.owner_id, t.at))
    return Dataset(txns=txns)
