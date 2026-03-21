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
from typing import Optional
from genlayer.std import *  # provides: gl, u256, Address, TreeMap, require

# ── Status labels ─────────────────────────────────────────────────────────────
OPEN      = "OPEN"
MATCHED   = "MATCHED"
PROPOSED  = "PROPOSED"
DISPUTED  = "DISPUTED"
SETTLED   = "SETTLED"
CANCELLED = "CANCELLED"

# ── Timing & consensus ────────────────────────────────────────────────────────
DISPUTE_WINDOW_SECS = 300   # 5 minutes — challenge window after a proposal
DEMOCRACY_NODES     = 3     # validators used in the Democracy Phase

# ── Gas-optimisation: cap string storage to avoid unnecessary gas burn ────────
MAX_URL_LEN      = 256   # bytes
MAX_CRITERIA_LEN = 512   # bytes

# ── AI Oracle system prompt ───────────────────────────────────────────────────
# Structured strictly to satisfy the Principle of Equivalence (temperature=0).
# Uses double-braces {{ }} to escape the format() call.
_ORACLE_SYSTEM_PROMPT = """\
You are an impartial Data Verification Protocol. \
Your only task is to verify whether a stated criteria is satisfied \
based on real-time data from a given web source.

STRICT RULES:
1. Fetch and read SOURCE_URL.
2. Evaluate CRITERIA literally — no interpretation, no subjectivity.
3. Respond ONLY with the JSON object below. No markdown, no extra text.

OUTPUT SCHEMA (return exactly this structure):
{{"winner": "maker" | "taker" | "invalid", "reason": "<one concise sentence>"}}

DECISION LOGIC:
- "maker"   → CRITERIA is EXACTLY and UNAMBIGUOUSLY satisfied.
- "taker"   → CRITERIA is CLEARLY NOT satisfied.
- "invalid" → URL unreachable | data ambiguous | criteria subjective | any error.

SOURCE_URL : {source_url}
CRITERIA   : {criteria}
"""


class FairStake(gl.Contract):
    """P2P Betting contract with AI-judged resolution (Reentrancy Safe)."""

    # ── Persistent storage ────────────────────────────────────────────────────
    bets:      TreeMap[u256, dict]
    bet_count: u256

    # ── Constructor ───────────────────────────────────────────────────────────
    def __init__(self) -> None:
        self.bets      = TreeMap()
        self.bet_count = u256(0)

    # =========================================================================
    # INTERNAL HELPERS
    # =========================================================================

    def _get_bet(self, bet_id: u256) -> dict:
        require(int(bet_id) < int(self.bet_count), "Bet does not exist")
        return self.bets[bet_id]

    def _save_bet(self, bet_id: u256, bet: dict) -> None:
        self.bets[bet_id] = bet

    async def _call_oracle(self, bet: dict, *, num_validators: int = 1) -> str:
        """
        Execute the AI oracle to evaluate a bet.

        Returns "maker" | "taker" | "invalid".

        num_validators=1  → Optimistic Phase  (single node, fast)
        num_validators=3+ → Democracy Phase   (multi-node consensus)

        NOTE: In the GenLayer protocol, `num_validators` instructs the
        framework on how many Intelligent Nodes must reach consensus before
        the transaction is committed. temperature=0 enforces the
        Principle of Equivalence (deterministic output across all nodes).
        """
        prompt = _ORACLE_SYSTEM_PROMPT.format(
            source_url=bet["source_url"],
            criteria=bet["criteria"],
        )

        raw = await gl.exec_prompt(
            prompt,
            temperature    = 0,
            max_tokens     = 200,
            web_resources  = [bet["source_url"]],
            num_validators = num_validators,
        )

        try:
            verdict = json.loads(raw.strip())
            winner  = verdict.get("winner", "invalid")
            return winner if winner in ("maker", "taker", "invalid") else "invalid"
        except (json.JSONDecodeError, AttributeError, TypeError):
            return "invalid"

    def _address_of(self, bet: dict, winner_key: str) -> Optional[str]:
        """Resolve 'maker'/'taker'/'invalid' to an actual address."""
        if winner_key == "maker":
            return bet["maker"]
        if winner_key == "taker":
            return bet["taker"]
        return None

    # =========================================================================
    # PUBLIC WRITE FUNCTIONS
    # =========================================================================

    @gl.public.write
    def create_bet(
        self,
        source_url: str,
        criteria:   str,
        deadline:   u256,
    ) -> u256:
        """
        Create a new open bet.
        msg.value is the stake — both parties will match this exact amount.

        Events emitted: BetCreated
        """
        # ── Validations ───────────────────────────────────────────────────────
        require(int(gl.message.value) > 0,
                "Stake must be greater than 0")
        require(int(deadline) > int(gl.message.timestamp),
                "Deadline must be in the future")
        require(len(source_url) <= MAX_URL_LEN,
                f"source_url exceeds {MAX_URL_LEN} chars — optimise for gas")
        require(len(criteria) <= MAX_CRITERIA_LEN,
                f"criteria exceeds {MAX_CRITERIA_LEN} chars — optimise for gas")

        bet_id = self.bet_count

        # ── Effects ───────────────────────────────────────────────────────────
        bet: dict = {
            "id":              int(bet_id),
            "maker":           str(gl.message.sender),
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

        # ── Event ─────────────────────────────────────────────────────────────
        gl.emit_event("BetCreated", {
            "bet_id":   int(bet_id),
            "maker":    str(gl.message.sender),
            "amount":   int(gl.message.value),
            "deadline": int(deadline),
        })

        return bet_id

    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write
    def join_bet(self, bet_id: u256) -> None:
        """
        Taker joins an open bet.
        msg.value must match the Maker's stake exactly (1v1 parity).
        Taker cannot be the same address as the Maker.

        Events emitted: BetMatched
        """
        bet = self._get_bet(bet_id)

        # ── Validations ───────────────────────────────────────────────────────
        require(bet["status"] == OPEN,
                "Bet is not open for joining")
        require(str(gl.message.sender) != bet["maker"],
                "Maker cannot join their own bet as Taker")
        require(int(gl.message.value) == bet["amount"],
                "msg.value must match the bet amount exactly")
        require(int(gl.message.timestamp) < bet["deadline"],
                "Bet deadline has already passed")

        # ── Effects ───────────────────────────────────────────────────────────
        bet["taker"]  = str(gl.message.sender)
        bet["status"] = MATCHED
        self._save_bet(bet_id, bet)

        # ── Event ─────────────────────────────────────────────────────────────
        gl.emit_event("BetMatched", {
            "bet_id": int(bet_id),
            "taker":  str(gl.message.sender),
            "amount": bet["amount"],
        })

    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write
    async def resolve_bet(self, bet_id: u256) -> None:
        """
        Trigger AI resolution after the deadline.

        Optimistic Phase: single validator proposes a winner.
        Result is PROPOSED — a 5-minute challenge window opens.
        If the AI returns 'invalid', both parties are refunded immediately.

        Events emitted: BetResolved
        """
        bet = self._get_bet(bet_id)

        # ── Validations ───────────────────────────────────────────────────────
        require(bet["status"] == MATCHED,
                "Bet must be in MATCHED status to resolve")
        require(int(gl.message.timestamp) >= bet["deadline"],
                "Deadline has not been reached yet")

        # ── AI Oracle — Optimistic Phase (1 validator, temperature=0) ─────────
        winner_key   = await self._call_oracle(bet, num_validators=1)
        proposed_addr = self._address_of(bet, winner_key)

        if proposed_addr is None:
            # ── INVALID: cancel and refund both parties ────────────────────
            # CEI: update state BEFORE transferring funds (reentrancy safe)
            bet["status"] = CANCELLED
            self._save_bet(bet_id, bet)

            gl.transfer(bet["maker"], bet["amount"])
            gl.transfer(bet["taker"], bet["amount"])

            gl.emit_event("BetResolved", {
                "bet_id": int(bet_id),
                "winner": None,
                "status": CANCELLED,
                "phase":  "optimistic",
            })
            return

        # ── Effects: record proposal, open challenge window ───────────────────
        bet["proposed_winner"] = proposed_addr
        bet["proposed_at"]     = int(gl.message.timestamp)
        bet["status"]          = PROPOSED
        self._save_bet(bet_id, bet)

        # ── Event ─────────────────────────────────────────────────────────────
        gl.emit_event("BetResolved", {
            "bet_id":          int(bet_id),
            "proposed_winner": proposed_addr,
            "status":          PROPOSED,
            "phase":           "optimistic",
        })

    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write
    async def dispute_bet(self, bet_id: u256) -> None:
        """
        Dispute a proposed result within the 5-minute challenge window.

        Democracy Phase: DEMOCRACY_NODES validators re-evaluate the bet.
        The multi-node consensus overrides the optimistic proposal.
        Prize is transferred immediately upon democratic settlement.

        Events emitted: BetResolved
        """
        bet = self._get_bet(bet_id)

        # ── Validations ───────────────────────────────────────────────────────
        require(bet["status"] == PROPOSED,
                "Bet is not in PROPOSED state — cannot dispute")
        require(
            str(gl.message.sender) in (bet["maker"], bet["taker"]),
            "Only Maker or Taker can dispute",
        )
        elapsed = int(gl.message.timestamp) - bet["proposed_at"]
        require(elapsed <= DISPUTE_WINDOW_SECS,
                "Dispute window has expired (5-minute limit)")

        # ── Effects: mark DISPUTED before external call (reentrancy guard) ────
        bet["status"] = DISPUTED
        self._save_bet(bet_id, bet)

        # ── AI Oracle — Democracy Phase (DEMOCRACY_NODES validators) ──────────
        winner_key = await self._call_oracle(bet, num_validators=DEMOCRACY_NODES)
        final_addr = self._address_of(bet, winner_key)

        if final_addr is None:
            # Democracy also finds the bet invalid → cancel and refund
            bet["status"] = CANCELLED
            self._save_bet(bet_id, bet)

            gl.transfer(bet["maker"], bet["amount"])
            gl.transfer(bet["taker"], bet["amount"])

            gl.emit_event("BetResolved", {
                "bet_id": int(bet_id),
                "winner": None,
                "status": CANCELLED,
                "phase":  "democracy",
            })
            return

        # ── Effects: record democratic verdict ────────────────────────────────
        bet["proposed_winner"] = final_addr
        bet["status"]          = SETTLED
        self._save_bet(bet_id, bet)

        # ── Interactions: transfer full pool AFTER state update ───────────────
        gl.transfer(final_addr, bet["amount"] * 2)

        gl.emit_event("BetResolved", {
            "bet_id": int(bet_id),
            "winner": final_addr,
            "status": SETTLED,
            "phase":  "democracy",
        })

    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write
    def claim_prize(self, bet_id: u256) -> None:
        """
        Claim the full prize pool (amount × 2).

        Allowed only if:
          - status == PROPOSED  AND  ≥ 5 minutes have elapsed with no dispute.

        The CEI pattern guarantees reentrancy safety:
          1. CHECK  — verify status and timing.
          2. EFFECT — update status to SETTLED.
          3. INTERACT — transfer funds.

        Events emitted: PrizeClaimed
        """
        bet = self._get_bet(bet_id)

        # ── Checks ────────────────────────────────────────────────────────────
        require(
            bet["status"] == PROPOSED,
            "Bet is not claimable: must be PROPOSED with no active dispute "
            "(democracy-settled bets are paid out directly by dispute_bet)",
        )

        elapsed = int(gl.message.timestamp) - bet["proposed_at"]
        require(
            elapsed >= DISPUTE_WINDOW_SECS,
            f"Dispute window has not expired yet — wait {DISPUTE_WINDOW_SECS - elapsed}s",
        )

        winner = bet["proposed_winner"]
        require(winner is not None, "No winner determined")

        # ── Effects: update state BEFORE transfer (reentrancy safe) ──────────
        bet["status"] = SETTLED
        self._save_bet(bet_id, bet)

        # ── Interactions: single transfer point for the happy path ────────────
        payout = bet["amount"] * 2
        gl.transfer(winner, payout)

        gl.emit_event("PrizeClaimed", {
            "bet_id": int(bet_id),
            "winner": winner,
            "payout": payout,
        })

    # =========================================================================
    # PUBLIC VIEW FUNCTIONS (read-only, no gas for pure queries)
    # =========================================================================

    @gl.public.view
    def get_bet(self, bet_id: u256) -> dict:
        """Return all fields of a single bet."""
        return self._get_bet(bet_id)

    @gl.public.view
    def get_bet_count(self) -> u256:
        """Return the total number of bets ever created."""
        return self.bet_count

    @gl.public.view
    def get_open_bets(self) -> list:
        """Return all OPEN bets — used by the frontend marketplace."""
        result = []
        for i in range(int(self.bet_count)):
            bet = self.bets[u256(i)]
            if bet["status"] == OPEN:
                result.append(bet)
        return result

    @gl.public.view
    def get_bets_by_address(self, addr: str) -> list:
        """Return all bets where the address is Maker or Taker (My Bets view)."""
        result = []
        for i in range(int(self.bet_count)):
            bet = self.bets[u256(i)]
            if bet["maker"] == addr or bet["taker"] == addr:
                result.append(bet)
        return result
