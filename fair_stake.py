# { "Depends": "py-genlayer:test" }
"""
FairStake — P2P Betting Smart Contract
Platform : GenLayer (Bradbury Testnet)
Oracle   : AI-judged resolution via Optimistic Democracy

State machine:
    OPEN ──► MATCHED ──► PROPOSED ──► SETTLED   (happy path, no dispute)
                    │            └──► CANCELLED  (claim after dispute-window finds no winner)
                    └──► CANCELLED               (AI returns invalid on resolve_bet)
             PROPOSED ──► DISPUTED ──► SETTLED | CANCELLED  (dispute path)
"""

import json
import datetime as _dt
from typing import Optional
from genlayer import *

# ── Status labels ─────────────────────────────────────────────────────────────
OPEN      = "OPEN"
MATCHED   = "MATCHED"
PROPOSED  = "PROPOSED"
DISPUTED  = "DISPUTED"
SETTLED   = "SETTLED"
CANCELLED = "CANCELLED"

# ── Timing & consensus ────────────────────────────────────────────────────────
DISPUTE_WINDOW_SECS = 300   # 5 minutes — challenge window after a proposal

# ── Gas-optimisation: cap string storage to avoid unnecessary gas burn ────────
MAX_URL_LEN      = 256
MAX_CRITERIA_LEN = 512

# ── AI Oracle system prompt ───────────────────────────────────────────────────
_ORACLE_SYSTEM_PROMPT = """\
You are an impartial Data Verification Protocol.
Your only task is to verify whether a stated criteria is satisfied
based on real-time data from a given web source.

Web page content:
{web_data}

CRITERIA: {criteria}

STRICT RULES:
1. Evaluate CRITERIA literally — no interpretation, no subjectivity.
2. Respond ONLY with the JSON object below. No markdown, no extra text.

OUTPUT SCHEMA (return exactly this structure):
{{"winner": "maker" | "taker" | "invalid", "reason": "<one concise sentence>"}}

DECISION LOGIC:
- "maker"   → CRITERIA is EXACTLY and UNAMBIGUOUSLY satisfied.
- "taker"   → CRITERIA is CLEARLY NOT satisfied.
- "invalid" → data ambiguous | criteria subjective | any error.
"""


def _now_unix() -> int:
    """Parse gl.message.datetime (ISO string) to Unix timestamp integer."""
    dt_str = gl.message.datetime.replace("Z", "+00:00")
    dt = _dt.datetime.fromisoformat(dt_str)
    return int(dt.timestamp())


class FairStake(gl.Contract):
    """P2P Betting contract with AI-judged resolution."""

    bets:      TreeMap[u256, dict]
    bet_count: u256

    def __init__(self) -> None:
        self.bet_count = u256(0)

    # =========================================================================
    # INTERNAL HELPERS
    # =========================================================================

    def _get_bet(self, bet_id: u256) -> dict:
        if int(bet_id) >= int(self.bet_count):
            raise Exception("Bet does not exist")
        return self.bets[bet_id]

    def _save_bet(self, bet_id: u256, bet: dict) -> None:
        self.bets[bet_id] = bet

    def _call_oracle(self, bet: dict) -> str:
        """
        Execute AI oracle synchronously using gl.eq_principle_strict_eq.
        Returns 'maker' | 'taker' | 'invalid'.
        """
        source_url = bet["source_url"]
        criteria   = bet["criteria"]

        def get_verdict() -> str:
            web_data = gl.get_webpage(source_url, mode="text")
            prompt = _ORACLE_SYSTEM_PROMPT.format(
                web_data=web_data,
                criteria=criteria,
            )
            result = gl.exec_prompt(prompt)
            return json.dumps(json.loads(result), sort_keys=True)

        try:
            raw     = gl.eq_principle_strict_eq(get_verdict)
            verdict = json.loads(raw)
            winner  = verdict.get("winner", "invalid")
            return winner if winner in ("maker", "taker", "invalid") else "invalid"
        except Exception:
            return "invalid"

    def _address_of(self, bet: dict, winner_key: str) -> Optional[str]:
        if winner_key == "maker":
            return bet["maker"]
        if winner_key == "taker":
            return bet["taker"]
        return None

    # =========================================================================
    # PUBLIC WRITE FUNCTIONS
    # =========================================================================

    @gl.public.write
    def create_bet(self, source_url: str, criteria: str, deadline: u256) -> u256:
        """Create a new open bet. msg.value is the stake."""
        if int(gl.message.value) <= 0:
            raise Exception("Stake must be greater than 0")
        if int(deadline) <= _now_unix():
            raise Exception("Deadline must be in the future")
        if len(source_url) > MAX_URL_LEN:
            raise Exception(f"source_url exceeds {MAX_URL_LEN} chars")
        if len(criteria) > MAX_CRITERIA_LEN:
            raise Exception(f"criteria exceeds {MAX_CRITERIA_LEN} chars")

        bet_id = self.bet_count

        bet: dict = {
            "id":              int(bet_id),
            "maker":           str(gl.message.sender_address),
            "taker":           None,
            "amount":          int(gl.message.value),
            "source_url":      source_url,
            "criteria":        criteria,
            "deadline":        int(deadline),
            "proposed_winner": None,
            "proposed_at":     0,
            "status":          OPEN,
        }
        self._save_bet(bet_id, bet)
        self.bet_count = u256(int(bet_id) + 1)
        return bet_id

    @gl.public.write
    def join_bet(self, bet_id: u256) -> None:
        """Taker joins an open bet with matching stake."""
        bet = self._get_bet(bet_id)

        if bet["status"] != OPEN:
            raise Exception("Bet is not open for joining")
        if str(gl.message.sender_address) == bet["maker"]:
            raise Exception("Maker cannot join their own bet as Taker")
        if int(gl.message.value) != bet["amount"]:
            raise Exception("msg.value must match the bet amount exactly")
        if _now_unix() >= bet["deadline"]:
            raise Exception("Bet deadline has already passed")

        bet["taker"]  = str(gl.message.sender_address)
        bet["status"] = MATCHED
        self._save_bet(bet_id, bet)

    @gl.public.write
    def resolve_bet(self, bet_id: u256) -> None:
        """Trigger AI resolution after the deadline (Optimistic Phase)."""
        bet = self._get_bet(bet_id)

        if bet["status"] != MATCHED:
            raise Exception("Bet must be in MATCHED status to resolve")
        if _now_unix() < bet["deadline"]:
            raise Exception("Deadline has not been reached yet")

        winner_key    = self._call_oracle(bet)
        proposed_addr = self._address_of(bet, winner_key)

        if proposed_addr is None:
            bet["status"] = CANCELLED
            self._save_bet(bet_id, bet)
            gl.transfer(bet["maker"], bet["amount"])
            gl.transfer(bet["taker"], bet["amount"])
            return

        bet["proposed_winner"] = proposed_addr
        bet["proposed_at"]     = _now_unix()
        bet["status"]          = PROPOSED
        self._save_bet(bet_id, bet)

    @gl.public.write
    def dispute_bet(self, bet_id: u256) -> None:
        """Dispute a proposed result within the 5-minute challenge window."""
        bet = self._get_bet(bet_id)

        if bet["status"] != PROPOSED:
            raise Exception("Bet is not in PROPOSED state — cannot dispute")
        sender = str(gl.message.sender_address)
        if sender not in (bet["maker"], bet["taker"]):
            raise Exception("Only Maker or Taker can dispute")
        elapsed = _now_unix() - bet["proposed_at"]
        if elapsed > DISPUTE_WINDOW_SECS:
            raise Exception("Dispute window has expired (5-minute limit)")

        bet["status"] = DISPUTED
        self._save_bet(bet_id, bet)

        winner_key = self._call_oracle(bet)
        final_addr = self._address_of(bet, winner_key)

        if final_addr is None:
            bet["status"] = CANCELLED
            self._save_bet(bet_id, bet)
            gl.transfer(bet["maker"], bet["amount"])
            gl.transfer(bet["taker"], bet["amount"])
            return

        bet["proposed_winner"] = final_addr
        bet["status"]          = SETTLED
        self._save_bet(bet_id, bet)
        gl.transfer(final_addr, bet["amount"] * 2)

    @gl.public.write
    def claim_prize(self, bet_id: u256) -> None:
        """Claim prize after dispute window expires with no challenge."""
        bet = self._get_bet(bet_id)

        if bet["status"] != PROPOSED:
            raise Exception("Bet is not claimable: must be PROPOSED with no active dispute")

        elapsed = _now_unix() - bet["proposed_at"]
        if elapsed < DISPUTE_WINDOW_SECS:
            raise Exception(f"Dispute window has not expired yet")

        winner = bet["proposed_winner"]
        if winner is None:
            raise Exception("No winner determined")

        bet["status"] = SETTLED
        self._save_bet(bet_id, bet)
        gl.transfer(winner, bet["amount"] * 2)

    # =========================================================================
    # PUBLIC VIEW FUNCTIONS
    # =========================================================================

    @gl.public.view
    def get_bet(self, bet_id: u256) -> dict:
        return self._get_bet(bet_id)

    @gl.public.view
    def get_bet_count(self) -> u256:
        return self.bet_count

    @gl.public.view
    def get_open_bets(self) -> list:
        result = []
        for i in range(int(self.bet_count)):
            bet = self.bets[u256(i)]
            if bet["status"] == OPEN:
                result.append(bet)
        return result

    @gl.public.view
    def get_bets_by_address(self, addr: str) -> list:
        result = []
        for i in range(int(self.bet_count)):
            bet = self.bets[u256(i)]
            if bet["maker"] == addr or bet["taker"] == addr:
                result.append(bet)
        return result
