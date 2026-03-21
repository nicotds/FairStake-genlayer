"""
FairStake — Test Suite
======================
Covers the four core scenarios requested:

  Test 1 — create_bet + join_bet succeed end-to-end.
  Test 2 — join_bet with wrong amount (too low, too high) must raise.
  Test 3 — resolve_bet calls AI oracle and transitions status to PROPOSED.
  Test 4 — claim_prize raises when called before the 5-minute dispute window.

Run locally (mocked context):
  pytest test_fair_stake.py -v

Run against Bradbury testnet (when genlayer CLI is installed):
  genlayer test test_fair_stake.py
"""

# ── 0. Mock the GenLayer stdlib BEFORE importing the contract ─────────────────
# This lets us run all tests without a live node.
# Each test can override gl.message.sender / .value / .timestamp and
# gl._ai_response to simulate different scenarios.

import sys
import json
import types
import asyncio
import pytest
from typing import Optional

# ── Mock primitives ───────────────────────────────────────────────────────────

class u256(int):
    """Thin wrapper that behaves exactly like int."""
    pass


def require(condition: bool, message: str = "Requirement failed") -> None:
    if not condition:
        raise AssertionError(message)


class TreeMap(dict):
    """In-memory TreeMap backed by a plain dict."""
    pass


class MockMessage:
    def __init__(self) -> None:
        self.sender    = "0xMAKER_ADDRESS_0000000000000000000000001"
        self.value     = 1_000   # wei equivalent
        self.timestamp = 1_700_000_000  # Unix epoch


class MockGL:
    """
    Mimics the `gl` context object injected by the GenLayer runtime.
    Tests mutate .message and ._ai_response to drive different scenarios.
    """

    def __init__(self) -> None:
        self.message      = MockMessage()
        self._transfers:  list = []
        self._events:     list = []
        self._ai_response: str = json.dumps(
            {"winner": "maker", "reason": "BTC price exceeded threshold."}
        )

    # Reset between tests
    def reset(self) -> None:
        self.message      = MockMessage()
        self._transfers   = []
        self._events      = []
        self._ai_response = json.dumps(
            {"winner": "maker", "reason": "BTC price exceeded threshold."}
        )

    # ── GenLayer API surface ──────────────────────────────────────────────────
    def transfer(self, to: str, amount: int) -> None:
        self._transfers.append({"to": str(to), "amount": int(amount)})

    def emit_event(self, name: str, data: dict) -> None:
        self._events.append({"name": name, "data": data})

    async def exec_prompt(
        self,
        prompt: str,
        *,
        temperature:    float = 0,
        max_tokens:     int   = 200,
        web_resources:  Optional[list] = None,
        num_validators: int   = 1,
    ) -> str:
        return self._ai_response

    # ── Decorator stubs ───────────────────────────────────────────────────────
    class public:
        @staticmethod
        def write(fn):
            return fn

        @staticmethod
        def view(fn):
            return fn

    # ── Contract base class ───────────────────────────────────────────────────
    class Contract:
        pass


# ── Instantiate the mock and inject into sys.modules ─────────────────────────
gl = MockGL()

_std_module           = types.ModuleType("genlayer.std")
_std_module.gl        = gl
_std_module.u256      = u256
_std_module.require   = require
_std_module.TreeMap   = TreeMap
_std_module.Address   = str
_std_module.__all__   = ["gl", "u256", "require", "TreeMap", "Address"]

_root_module          = types.ModuleType("genlayer")
_root_module.std      = _std_module

sys.modules["genlayer"]     = _root_module
sys.modules["genlayer.std"] = _std_module

# ── NOW import the contract (genlayer is already patched) ─────────────────────
from fair_stake import (  # noqa: E402
    FairStake,
    OPEN, MATCHED, PROPOSED, DISPUTED, SETTLED, CANCELLED,
    DISPUTE_WINDOW_SECS,
)

# ─────────────────────────────────────────────────────────────────────────────
# ADDRESSES
# ─────────────────────────────────────────────────────────────────────────────
MAKER   = "0xMAKER_ADDRESS_0000000000000000000000001"
TAKER   = "0xTAKER_ADDRESS_0000000000000000000000002"
THIRD   = "0xTHIRD_ADDRESS_000000000000000000000003"

STAKE   = 1_000                       # wei
NOW     = 1_700_000_000               # base timestamp
FUTURE  = NOW + 3_600                 # deadline 1 h from now

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def run(coro):
    """Shorthand to run an async method synchronously in tests."""
    return asyncio.run(coro)


def make_contract() -> FairStake:
    """Deploy a fresh contract instance with a reset mock context."""
    gl.reset()
    return FairStake()


def create_open_bet(contract: FairStake, *, deadline=FUTURE) -> u256:
    """Helper: create a bet as MAKER with STAKE."""
    gl.message.sender    = MAKER
    gl.message.value     = STAKE
    gl.message.timestamp = NOW
    return contract.create_bet(
        source_url="https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        criteria="BTC/USD price is above 60000 at the deadline timestamp",
        deadline=u256(deadline),
    )


def create_matched_bet(contract: FairStake) -> u256:
    """Helper: create + join a bet, returning the bet_id."""
    bet_id = create_open_bet(contract)
    gl.message.sender    = TAKER
    gl.message.value     = STAKE
    gl.message.timestamp = NOW
    contract.join_bet(bet_id)
    return bet_id


# ─────────────────────────────────────────────────────────────────────────────
# TEST 1 — SUCCESSFUL CREATE & JOIN
# ─────────────────────────────────────────────────────────────────────────────

class TestCreateAndJoin:

    def test_create_bet_stores_correct_data(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        assert int(bet_id) == 0
        bet = contract.get_bet(bet_id)

        assert bet["status"] == OPEN
        assert bet["maker"]  == MAKER
        assert bet["taker"]  is None
        assert bet["amount"] == STAKE

    def test_create_bet_increments_count(self):
        contract = make_contract()
        create_open_bet(contract)
        create_open_bet(contract)

        assert int(contract.get_bet_count()) == 2

    def test_create_bet_emits_bet_created_event(self):
        contract = make_contract()
        create_open_bet(contract)

        events = [e for e in gl._events if e["name"] == "BetCreated"]
        assert len(events) == 1
        assert events[0]["data"]["maker"] == MAKER

    def test_join_bet_transitions_to_matched(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender    = TAKER
        gl.message.value     = STAKE
        gl.message.timestamp = NOW
        contract.join_bet(bet_id)

        bet = contract.get_bet(bet_id)
        assert bet["status"] == MATCHED
        assert bet["taker"]  == TAKER

    def test_join_bet_emits_bet_matched_event(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender = TAKER
        gl.message.value  = STAKE
        contract.join_bet(bet_id)

        events = [e for e in gl._events if e["name"] == "BetMatched"]
        assert len(events) == 1
        assert events[0]["data"]["taker"] == TAKER

    def test_join_bet_rejects_second_taker(self):
        """Once a Taker has joined, the bet must be locked (MATCHED, not OPEN)."""
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl.message.sender = THIRD
        gl.message.value  = STAKE
        with pytest.raises(AssertionError, match="not open"):
            contract.join_bet(bet_id)


# ─────────────────────────────────────────────────────────────────────────────
# TEST 2 — JOIN WITH WRONG AMOUNT MUST FAIL
# ─────────────────────────────────────────────────────────────────────────────

class TestJoinAmountValidation:

    def test_join_with_less_than_required_fails(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender = TAKER
        gl.message.value  = STAKE - 1  # 1 wei too little

        with pytest.raises(AssertionError, match="msg.value must match"):
            contract.join_bet(bet_id)

    def test_join_with_more_than_required_fails(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender = TAKER
        gl.message.value  = STAKE + 1  # 1 wei too much

        with pytest.raises(AssertionError, match="msg.value must match"):
            contract.join_bet(bet_id)

    def test_join_with_zero_fails(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender = TAKER
        gl.message.value  = 0

        with pytest.raises(AssertionError, match="msg.value must match"):
            contract.join_bet(bet_id)

    def test_maker_cannot_be_taker(self):
        """Maker joining their own bet must be rejected."""
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender = MAKER  # same as maker
        gl.message.value  = STAKE

        with pytest.raises(AssertionError, match="Maker cannot join"):
            contract.join_bet(bet_id)

    def test_join_after_deadline_fails(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.sender    = TAKER
        gl.message.value     = STAKE
        gl.message.timestamp = FUTURE + 1  # past the deadline

        with pytest.raises(AssertionError, match="deadline"):
            contract.join_bet(bet_id)


# ─────────────────────────────────────────────────────────────────────────────
# TEST 3 — AI RESOLUTION TRANSITIONS STATUS TO PROPOSED
# ─────────────────────────────────────────────────────────────────────────────

class TestAIResolution:

    def test_resolve_bet_transitions_to_proposed(self):
        """AI returns 'maker' → status must become PROPOSED."""
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl._ai_response      = json.dumps({"winner": "maker", "reason": "Above threshold."})
        gl.message.sender    = MAKER
        gl.message.timestamp = FUTURE + 1  # past the deadline

        run(contract.resolve_bet(bet_id))

        bet = contract.get_bet(bet_id)
        assert bet["status"]          == PROPOSED
        assert bet["proposed_winner"] == MAKER
        assert bet["proposed_at"]     == gl.message.timestamp

    def test_resolve_emits_bet_resolved_event(self):
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl._ai_response      = json.dumps({"winner": "taker", "reason": "Below threshold."})
        gl.message.timestamp = FUTURE + 1

        run(contract.resolve_bet(bet_id))

        events = [e for e in gl._events if e["name"] == "BetResolved"]
        assert len(events) == 1
        data = events[0]["data"]
        assert data["status"] == PROPOSED
        assert data["proposed_winner"] == TAKER

    def test_resolve_ai_invalid_cancels_and_refunds(self):
        """AI returns 'invalid' → both parties must be refunded, status CANCELLED."""
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl._ai_response      = json.dumps({"winner": "invalid", "reason": "URL unreachable."})
        gl.message.timestamp = FUTURE + 1

        run(contract.resolve_bet(bet_id))

        bet = contract.get_bet(bet_id)
        assert bet["status"] == CANCELLED

        transfers = gl._transfers
        recipients = {t["to"] for t in transfers}
        assert MAKER in recipients
        assert TAKER in recipients
        for t in transfers:
            assert t["amount"] == STAKE  # each gets their stake back

    def test_resolve_before_deadline_fails(self):
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl.message.timestamp = NOW  # deadline not reached

        with pytest.raises(AssertionError, match="Deadline has not been reached"):
            run(contract.resolve_bet(bet_id))

    def test_resolve_on_unmatched_bet_fails(self):
        contract = make_contract()
        bet_id   = create_open_bet(contract)

        gl.message.timestamp = FUTURE + 1

        with pytest.raises(AssertionError, match="MATCHED"):
            run(contract.resolve_bet(bet_id))

    def test_resolve_ai_taker_wins(self):
        """Verify that 'taker' verdict also sets the correct proposed_winner."""
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl._ai_response      = json.dumps({"winner": "taker", "reason": "Criteria not met."})
        gl.message.timestamp = FUTURE + 1

        run(contract.resolve_bet(bet_id))

        bet = contract.get_bet(bet_id)
        assert bet["proposed_winner"] == TAKER


# ─────────────────────────────────────────────────────────────────────────────
# TEST 4 — CLAIM_PRIZE FAILS BEFORE DISPUTE WINDOW EXPIRES
# ─────────────────────────────────────────────────────────────────────────────

class TestClaimPrize:

    def _setup_proposed_bet(self) -> tuple[FairStake, u256]:
        """Create a bet that has been AI-resolved to PROPOSED status."""
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl._ai_response      = json.dumps({"winner": "maker", "reason": "Criteria met."})
        gl.message.timestamp = FUTURE + 1  # resolve at T+1
        run(contract.resolve_bet(bet_id))

        return contract, bet_id

    def test_claim_before_dispute_window_fails(self):
        """claim_prize must raise if called immediately after resolution (0 s elapsed)."""
        contract, bet_id = self._setup_proposed_bet()

        # Try to claim at the exact same timestamp as proposed_at
        resolved_at          = contract.get_bet(bet_id)["proposed_at"]
        gl.message.timestamp = resolved_at + 10  # only 10 s elapsed, need 300

        with pytest.raises(AssertionError, match="Dispute window has not expired"):
            contract.claim_prize(bet_id)

    def test_claim_at_boundary_minus_one_second_fails(self):
        """One second before the window closes must still fail."""
        contract, bet_id = self._setup_proposed_bet()

        resolved_at          = contract.get_bet(bet_id)["proposed_at"]
        gl.message.timestamp = resolved_at + DISPUTE_WINDOW_SECS - 1

        with pytest.raises(AssertionError, match="Dispute window has not expired"):
            contract.claim_prize(bet_id)

    def test_claim_after_dispute_window_succeeds(self):
        """Exactly at or after the 5-minute mark, claim_prize must pay out."""
        contract, bet_id = self._setup_proposed_bet()

        resolved_at          = contract.get_bet(bet_id)["proposed_at"]
        gl.message.timestamp = resolved_at + DISPUTE_WINDOW_SECS  # exactly 300 s

        contract.claim_prize(bet_id)

        bet = contract.get_bet(bet_id)
        assert bet["status"] == SETTLED

        # Verify the full pool (2×STAKE) was transferred to the winner
        assert len(gl._transfers) == 1
        assert gl._transfers[0]["to"]     == MAKER
        assert gl._transfers[0]["amount"] == STAKE * 2

    def test_claim_emits_prize_claimed_event(self):
        contract, bet_id = self._setup_proposed_bet()

        resolved_at          = contract.get_bet(bet_id)["proposed_at"]
        gl.message.timestamp = resolved_at + DISPUTE_WINDOW_SECS

        contract.claim_prize(bet_id)

        events = [e for e in gl._events if e["name"] == "PrizeClaimed"]
        assert len(events) == 1
        assert events[0]["data"]["winner"] == MAKER
        assert events[0]["data"]["payout"] == STAKE * 2

    def test_claim_on_settled_bet_fails(self):
        """Calling claim_prize twice (or on an already SETTLED bet) must fail."""
        contract, bet_id = self._setup_proposed_bet()

        resolved_at          = contract.get_bet(bet_id)["proposed_at"]
        gl.message.timestamp = resolved_at + DISPUTE_WINDOW_SECS

        contract.claim_prize(bet_id)  # first call — OK

        with pytest.raises(AssertionError, match="not claimable"):
            contract.claim_prize(bet_id)  # second call — must fail


# ─────────────────────────────────────────────────────────────────────────────
# BONUS — DISPUTE + DEMOCRACY FLOW
# ─────────────────────────────────────────────────────────────────────────────

class TestDisputeFlow:

    def _setup_proposed(self) -> tuple[FairStake, u256, int]:
        contract = make_contract()
        bet_id   = create_matched_bet(contract)

        gl._ai_response      = json.dumps({"winner": "maker", "reason": "Met."})
        gl.message.timestamp = FUTURE + 1
        run(contract.resolve_bet(bet_id))

        proposed_at = contract.get_bet(bet_id)["proposed_at"]
        return contract, bet_id, proposed_at

    def test_dispute_within_window_triggers_democracy(self):
        """A valid dispute must switch status to SETTLED with the democracy winner."""
        contract, bet_id, proposed_at = self._setup_proposed()

        # Taker disputes — democracy returns 'taker' as the winner
        gl._ai_response      = json.dumps({"winner": "taker", "reason": "Not met."})
        gl.message.sender    = TAKER
        gl.message.timestamp = proposed_at + 60  # 60 s in — within window

        run(contract.dispute_bet(bet_id))

        bet = contract.get_bet(bet_id)
        assert bet["status"]          == SETTLED
        assert bet["proposed_winner"] == TAKER
        assert gl._transfers[0]["to"] == TAKER
        assert gl._transfers[0]["amount"] == STAKE * 2

    def test_dispute_after_window_fails(self):
        """dispute_bet called after the 5-minute window must raise."""
        contract, bet_id, proposed_at = self._setup_proposed()

        gl.message.sender    = TAKER
        gl.message.timestamp = proposed_at + DISPUTE_WINDOW_SECS + 1

        with pytest.raises(AssertionError, match="Dispute window has expired"):
            run(contract.dispute_bet(bet_id))

    def test_dispute_by_non_participant_fails(self):
        """A third party must not be able to dispute."""
        contract, bet_id, proposed_at = self._setup_proposed()

        gl.message.sender    = THIRD
        gl.message.timestamp = proposed_at + 30

        with pytest.raises(AssertionError, match="Only Maker or Taker"):
            run(contract.dispute_bet(bet_id))

    def test_democracy_invalid_refunds_both(self):
        """If democracy also returns invalid, both parties must be refunded."""
        contract, bet_id, proposed_at = self._setup_proposed()

        gl._ai_response      = json.dumps({"winner": "invalid", "reason": "Ambiguous."})
        gl.message.sender    = TAKER
        gl.message.timestamp = proposed_at + 30

        run(contract.dispute_bet(bet_id))

        bet = contract.get_bet(bet_id)
        assert bet["status"] == CANCELLED

        recipients = {t["to"] for t in gl._transfers}
        assert MAKER in recipients
        assert TAKER in recipients
