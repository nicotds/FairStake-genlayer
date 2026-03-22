/**
 * genlayerService.ts
 * ──────────────────
 * Bridge layer between the Next.js frontend and the GenLayer Bradbury testnet.
 *
 * Uses the official genlayer-js SDK which handles:
 *   - gen_call (custom binary encoding, NOT eth_call)
 *   - Automatic JSON decoding of Python dict/list returns
 *   - AI transaction polling for resolve_bet / dispute_bet
 */

import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { FAIR_STAKE_ADDRESS } from '@/constants'
import type { Bet } from '@/constants/types'
import { BetStatus } from '@/constants'

// ── GenLayer client (read-only, no account needed for view calls) ───────────
const glClient = createClient({ chain: testnetBradbury })

// ── Timing for AI transaction polling ──────────────────────────────────────
const GL_POLL_MS          = 3_000
const GL_PENDING_STATE_MS = 15_000
const GL_TIMEOUT_MS       = 120_000

// ── Bet mapper ────────────────────────────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

function mapBet(raw: Record<string, unknown>): Bet {
  const rawStatus = String(raw.status ?? 'OPEN')
  const status: BetStatus = Object.values(BetStatus).includes(rawStatus as BetStatus)
    ? (rawStatus as BetStatus)
    : BetStatus.OPEN

  const rawProposedWinner = raw.proposed_winner
  const proposedWinner: `0x${string}` | null =
    rawProposedWinner && rawProposedWinner !== 'None' && rawProposedWinner !== null
      ? (rawProposedWinner as `0x${string}`)
      : null

  const rawTaker = raw.taker
  const taker: `0x${string}` =
    rawTaker && rawTaker !== 'None' && rawTaker !== null
      ? (rawTaker as `0x${string}`)
      : ZERO_ADDRESS

  return {
    id:             BigInt(String(raw.id ?? 0)),
    maker:          (raw.maker ?? ZERO_ADDRESS) as `0x${string}`,
    taker,
    criteria:       String(raw.criteria ?? ''),
    sourceUrl:      String(raw.source_url ?? ''),
    amount:         BigInt(String(raw.amount ?? 0)),
    deadline:       BigInt(String(raw.deadline ?? 0)),
    status,
    proposedWinner,
    aiReasoning:    '',
    proposedAt:     BigInt(String(raw.proposed_at ?? 0)),
  }
}

// ── Public read API ────────────────────────────────────────────────────────

export async function fetchBet(betId: number): Promise<Bet> {
  const raw = await glClient.readContract({
    address: FAIR_STAKE_ADDRESS,
    functionName: 'get_bet',
    args: [betId],
    jsonSafeReturn: true,
  })
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Bet #${betId} not found`)
  }
  return mapBet(raw as Record<string, unknown>)
}

export async function fetchOpenBets(): Promise<Bet[]> {
  const raw = await glClient.readContract({
    address: FAIR_STAKE_ADDRESS,
    functionName: 'get_open_bets',
    args: [],
    jsonSafeReturn: true,
  })
  if (!Array.isArray(raw)) return []
  return raw.map((r) => mapBet(r as Record<string, unknown>))
}

export async function fetchBetsByAddress(address: string): Promise<Bet[]> {
  const raw = await glClient.readContract({
    address: FAIR_STAKE_ADDRESS,
    functionName: 'get_bets_by_address',
    args: [address],
    jsonSafeReturn: true,
  })
  if (!Array.isArray(raw)) return []
  return raw.map((r) => mapBet(r as Record<string, unknown>))
}

export async function fetchBetCount(): Promise<number> {
  const raw = await glClient.readContract({
    address: FAIR_STAKE_ADDRESS,
    functionName: 'get_bet_count',
    args: [],
    jsonSafeReturn: true,
  })
  return Number(raw ?? 0)
}

// ── AI Transaction Polling ─────────────────────────────────────────────────

export type AITxState = 'idle' | 'pending' | 'ai-processing' | 'finalized' | 'timeout' | 'error'

export async function waitForAITransaction(
  hash: `0x${string}`,
  onState?: (s: AITxState) => void,
): Promise<boolean> {
  const deadline = Date.now() + GL_TIMEOUT_MS
  let attempt = 0

  onState?.('pending')

  while (Date.now() < deadline) {
    await sleep(GL_POLL_MS)
    attempt++

    if (attempt * GL_POLL_MS >= GL_PENDING_STATE_MS) {
      onState?.('ai-processing')
    }

    try {
      const receipt = await glClient.getTransactionReceipt({ hash })
      if (receipt) {
        const success = receipt.status === 'success'
        onState?.(success ? 'finalized' : 'error')
        return success
      }
    } catch {
      // Receipt not yet available — keep polling
    }
  }

  onState?.('timeout')
  return false
}

// Keep glPublicClient export for any external usage
export const glPublicClient = glClient

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
