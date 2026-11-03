"""HTTP API for the risk service.

Contract matches the TypeScript policy engine's ModelSignal. If the model
isn't loaded the service answers 503, and the policy engine holds the
payment (INV-10). Requests and responses never include memo text: callers
send labels, not content (INV-17, INV-21).
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .features import METHODS, TEXT_LABELS, PastPayment, Payment, compute
from .model import Explainer, load
from .scenarios import build as build_network_demo
from .sentinel import Level as NetLevel, assess

ARTIFACTS = Path(os.environ.get("RISK_ARTIFACTS_DIR", Path(__file__).resolve().parents[2] / "artifacts"))

app = FastAPI(title="Legacy Protection risk service", version="1.0.0")
_explainer: Explainer | None = None


def explainer() -> Explainer:
    global _explainer
    if _explainer is None:
        try:
            _explainer = Explainer(load(ARTIFACTS))
        except (FileNotFoundError, OSError) as e:
            raise HTTPException(status_code=503, detail="model not loaded") from e
    return _explainer


class PastPaymentIn(BaseModel):
    payeeId: str = Field(max_length=128)
    amountMinor: int = Field(gt=0, lt=10**12)
    at: datetime


class ScoreRequest(BaseModel):
    payeeId: str = Field(max_length=128)
    amountMinor: int = Field(gt=0, lt=10**12)
    currency: Literal["USD"]
    at: datetime
    hourLocal: int = Field(ge=0, le=23)
    method: Literal["p2p", "bank_transfer", "gift_card", "crypto"]
    textLabels: list[Literal[TEXT_LABELS]] = Field(default_factory=list, max_length=6)  # type: ignore[valid-type]
    history: list[PastPaymentIn] = Field(default_factory=list, max_length=5000)


class Reason(BaseModel):
    code: str
    text: str
    source: Literal["MODEL", "NETWORK"]


class Signal(BaseModel):
    model_config = {"extra": "ignore"}

    level: Literal["PASS", "REVIEW", "HOLD"]
    reasons: list[Reason]
    networkOnly: bool
    modelVersion: str


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "model": explainer().art.version}


@app.post("/v1/score", response_model=Signal)
def score(req: ScoreRequest) -> Signal:
    assert req.method in METHODS
    p = Payment(
        req.payeeId,
        req.amountMinor,
        int(req.at.timestamp()),
        req.hourLocal,
        req.method,
        tuple(req.textLabels),
    )
    hist = [PastPayment(h.payeeId, h.amountMinor, int(h.at.timestamp())) for h in req.history]
    out = explainer().score(compute(p, hist))
    return Signal.model_validate({**out, "networkOnly": False})


class NetworkRequest(BaseModel):
    payeeId: str = Field(max_length=128)


LevelName = Literal["PASS", "REVIEW", "HOLD"]
_NET_LEVELS: dict[NetLevel, LevelName] = {NetLevel.NONE: "PASS", NetLevel.ELEVATED: "REVIEW", NetLevel.HIGH: "HOLD"}


@app.post("/v1/network/payee", response_model=Signal)
def network_payee(req: NetworkRequest) -> Signal:
    """Abuse-ring sentinel. Demo network until PayPal-side data is wired in (ADR-0005)."""
    scn = build_network_demo()
    profile = scn.payees.get(req.payeeId)
    if profile is None:
        return Signal(level="PASS", reasons=[], networkOnly=True, modelVersion="sentinel-1.0.0")
    a = assess(profile, scn.payments, scn.outflows, scn.confirmed_fraud_payees, scn.as_of)
    return Signal(
        level=_NET_LEVELS[a.level],
        reasons=[Reason(code=c, text=t, source="NETWORK") for c, t in zip(a.reason_codes, a.reasons)],
        networkOnly=True,
        modelVersion=a.version,
    )
