import { type Chain } from 'viem'

// GenLayer Bradbury Network Configuration
export const bradburyChain: Chain = {
  id: 1337, // GenLayer Bradbury Chain ID
  name: 'GenLayer Bradbury',
  nativeCurrency: {
    decimals: 18,
    name: 'GEY',
    symbol: 'GEY',
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_GL_RPC_URL ?? 'https://rpc.bradbury.genlayer.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'GenLayer Explorer',
      url: 'https://explorer.bradbury.genlayer.com',
    },
  },
  testnet: true,
}

// ─── FairStake Contract ABI ────────────────────────────────────────────────
// Function names and argument ORDER must match fair_stake.py exactly.
// create_bet signature: create_bet(source_url, criteria, deadline)  ← source_url FIRST
// Read functions (get_bet, get_open_bets, get_bets_by_address) return Python
// dicts/lists — the service layer handles their JSON decoding directly.
export const FAIR_STAKE_ABI = [
  // ── Write functions ────────────────────────────────────────────────────
  {
    name: 'create_bet',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'source_url', type: 'string' },   // ← source_url is FIRST in the contract
      { name: 'criteria',   type: 'string' },
      { name: 'deadline',   type: 'uint256' },
    ],
    outputs: [{ name: 'bet_id', type: 'uint256' }],
  },
  {
    name: 'join_bet',                            // was: accept_bet (wrong)
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'bet_id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'resolve_bet',                         // was: propose_outcome (wrong)
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bet_id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'dispute_bet',                         // was: dispute (wrong)
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bet_id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'claim_prize',                         // was: claim_rewards (wrong)
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bet_id', type: 'uint256' }],
    outputs: [],
  },
  // ── Read functions — used only for ABI encoding in genlayerService ────
  {
    name: 'get_bet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'bet_id', type: 'uint256' }],
    // GenLayer returns a Python dict — decoded as JSON in genlayerService.ts
    outputs: [{ name: 'result', type: 'bytes' }],
  },
  {
    name: 'get_bet_count',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    name: 'get_open_bets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    // Returns list[dict] — decoded as JSON in genlayerService.ts
    outputs: [{ name: 'result', type: 'bytes' }],
  },
  {
    name: 'get_bets_by_address',               // was: get_user_bets (wrong)
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'string' }],
    outputs: [{ name: 'result', type: 'bytes' }],
  },
] as const

// Contract address — set NEXT_PUBLIC_FAIR_STAKE_ADDRESS in .env.local
export const FAIR_STAKE_ADDRESS = (
  process.env.NEXT_PUBLIC_FAIR_STAKE_ADDRESS ?? '0x0000000000000000000000000000000000000001'
) as `0x${string}`

// ─── Bet Status ───────────────────────────────────────────────────────────
// The Python contract stores and returns STATUS as plain strings (e.g. "OPEN").
// Using a const object (not a numeric enum) so TypeScript types match the wire values.
export const BetStatus = {
  OPEN:      'OPEN',
  MATCHED:   'MATCHED',
  PROPOSED:  'PROPOSED',
  DISPUTED:  'DISPUTED',
  SETTLED:   'SETTLED',     // was: RESOLVED (contract uses "SETTLED")
  CANCELLED: 'CANCELLED',
} as const

export type BetStatus = typeof BetStatus[keyof typeof BetStatus]

// Status Labels (human-readable)
export const STATUS_LABELS: Record<BetStatus, string> = {
  OPEN:      'OPEN',
  MATCHED:   'MATCHED',
  PROPOSED:  'PROPUESTO',
  DISPUTED:  'DISPUTADO',
  SETTLED:   'RESUELTO',
  CANCELLED: 'CANCELADO',
}

// Dispute Window in seconds (must match DISPUTE_WINDOW_SECS in fair_stake.py)
export const DISPUTE_WINDOW_SECONDS = 5 * 60
