"""Tests for the abuse-ring sentinel. Test names carry invariant IDs."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from hypothesis import given, settings
from hypothesis import strategies as st

from risk.scenarios import AS_OF, build
from risk.sentinel import (
    REASON_TEMPLATES,
    Level,
    Outflow,
    PayeeProfile,
    Payment,
    assess,
)


def _assess(scn, payee_id):
    return assess(
        scn.payees[payee_id], scn.payments, scn.outflows,
        scn.confirmed_fraud_payees, scn.as_of,
    )


def test_ring_mule_is_high():
    scn = build()
    a = _assess(scn, "mule_alpha")
    assert a.level is Level.HIGH
    assert "FAN_IN_5_9" in a.reason_codes
    assert "ACCOUNT_UNDER_WEEK" in a.reason_codes
    assert "RAPID_OUTFLOW" in a.reason_codes
    assert "CO_VICTIM_OVERLAP" in a.reason_codes


def test_everyday_payees_are_quiet():
    scn = build()
    for pid in ("utility_power", "pharmacy_main", "grocer_local"):
        a = _assess(scn, pid)
        assert a.level is Level.NONE
        assert a.reasons == ()


def test_INV14_caregiver_signal_is_flagged_network_only():
    # The sentinel honestly reports the caregiver's pattern (new account,
    # several new households). It marks the signal as network-only so the
    # policy engine can cap it at REVIEW for registered household employees.
    scn = build()
    a = _assess(scn, "caregiver_maria")
    assert a.level is Level.HIGH
    assert a.network_only is True
    assert "RAPID_OUTFLOW" not in a.reason_codes
    assert "CO_VICTIM_OVERLAP" not in a.reason_codes
    assert scn.registered_caregivers["caregiver_maria"]


def test_INV16_assessment_is_deterministic():
    scn = build()
    assert _assess(scn, "mule_alpha") == _assess(scn, "mule_alpha")
    assert build(seed=7) == build(seed=7)


def test_INV13_reasons_are_only_fixed_templates():
    scn = build()
    allowed = set(REASON_TEMPLATES.values())
    for pid in scn.payees:
        for r in _assess(scn, pid).reasons:
            assert r in allowed


ident = st.from_regex(r"[a-z]{3,8}_[0-9]{2,5}", fullmatch=True)


@settings(max_examples=200, deadline=None)
@given(
    payers=st.lists(ident, min_size=1, max_size=15, unique=True),
    payee=ident,
    age_days=st.integers(min_value=0, max_value=4000),
    hours=st.lists(st.integers(min_value=0, max_value=200), min_size=1, max_size=15),
)
def test_INV13_reasons_never_contain_other_account_identifiers(payers, payee, age_days, hours):
    payments = [
        Payment(f"{p}_owner", p, payee, 10_000, "USD", AS_OF - timedelta(hours=hours[i % len(hours)]))
        for i, p in enumerate(payers)
    ]
    outflows = [Outflow(payee, 9_000 * len(payers), "USD", AS_OF - timedelta(hours=1))]
    profile = PayeeProfile(payee, AS_OF - timedelta(days=age_days))
    a = assess(profile, payments, outflows, frozenset(), AS_OF)
    text = " ".join(a.reasons)
    for p in payers:
        assert p not in text
    assert payee not in text
    # No exact counts of customers, only buckets.
    assert not re.search(r"\b(1[1-9]|[2-9]\d)\b", text)


def test_INV11_signal_only_adds_caution_never_returns_negative_level():
    scn = build()
    for pid in scn.payees:
        assert _assess(scn, pid).level >= Level.NONE


def test_single_new_payer_is_not_flagged():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    profile = PayeeProfile("new_plumber", now - timedelta(days=2))
    payments = [Payment("a_owner", "a", "new_plumber", 50_000, "USD", now - timedelta(hours=3))]
    a = assess(profile, payments, [], frozenset(), now)
    assert a.level is Level.NONE
    assert a.reasons == ()
