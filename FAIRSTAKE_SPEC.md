# 💎 Project Specification: FairStake
**Platform:** GenLayer (Bradbury Testnet)
**Category:** P2P Prediction Markets & Betting
**Logic:** AI-Judged Decentralized Oracle

---

## 1. Core Vision
FairStake is a Peer-to-Peer (P2P) betting protocol where the judge is an Intelligent Node (AI). It eliminates human bias and centralized oracle dependencies. A "Maker" creates a bet with a specific web source and criteria, and a "Taker" accepts the challenge.

---

## 2. Technical Requirements (GenLayer Specifics)
- **Principle of Equivalence:** All AI calls must be deterministic.
  - Configuration: `temperature: 0`.
  - Prompting: Strict JSON output format.
- **Optimistic Democracy:**
  - **Optimistic Phase:** A single node proposes a result.
  - **Challenge Window:** 5 minutes for users to dispute.
  - **Democracy Phase:** If disputed, a multi-node vote (3-5 nodes) decides the final outcome.
- **Language:** Python for Smart Contracts (GenLayer Standard), React/Next.js for Frontend.

---

## 3. Smart Contract Architecture (fair_stake.py)

### Data Structures:
`Bet` object:
- `id`: Unique identifier.
- `maker`: Address of the creator.
- `taker`: Address of the challenger (initializes as null).
- `amount`: Collateral staked by each party (1v1 parity).
- `source_url`: The website/API the AI must read.
- `criteria`: Natural language rules (e.g., "If BTC > 60k at 12:00 UTC").
- `deadline`: Timestamp for resolution.
- `proposed_winner`: Address suggested by the first AI call.
- `status`: [OPEN, MATCHED, PROPOSED, DISPUTED, SETTLED, CANCELLED].

### Core Functions:
1. `create_bet(source_url, criteria, deadline)`: 
   - Receives `msg.value` (Stake).
   - Validates if the deadline is in the future.
2. `join_bet(bet_id)`: 
   - Requires `msg.value == bet.amount`.
   - Transitions status from `OPEN` to `MATCHED`.
3. `resolve_bet(bet_id)`:
   - Only executable after `deadline`.
   - Triggers `genlayer.call_ai()` with the Resolution Prompt.
   - Sets `status` to `PROPOSED`.
4. `dispute_bet(bet_id)`:
   - Executable only during the 5-min window.
   - Triggers a multi-node voting session (Democracy).
5. `claim_prize(bet_id)`:
   - Transfers the total pool (`amount * 2`) to the winner if no dispute or after democracy ends.

---

## 4. AI Oracle Prompting Strategy (The "Judge" Logic)
The System Prompt for the Intelligent Node must be:
- **Role:** Impartial Data Verifier.
- **Constraint:** Access the `source_url`, parse data, and apply `criteria` literally.
- **Output:** Must return ONLY a JSON object: `{"winner": "maker" | "taker" | "invalid", "reason": "string"}`.

---

## 5. Frontend Requirements (React + Tailwind)
- **Marketplace:** List all bets with status `OPEN`.
- **Creator UI:** Form with AI-pre-validation simulation.
- **My Bets:** Filtered view for the connected wallet (Maker or Taker roles).
- **Web3 Integration:** - Connect Wallet (Red Bradbury).
  - Real-time balance and transaction status.
  - Visual countdown for the "Dispute Window".

---

## 6. Security & Edge Cases
- **Invalid Source:** If the AI cannot access the URL, the bet is marked `CANCELLED` and funds are returned.
- **Ambiguous Criteria:** If the AI finds the criteria subjective, it must return `invalid`.
- **First-Come-First-Served:** Once a Taker joins, the bet is locked for others.