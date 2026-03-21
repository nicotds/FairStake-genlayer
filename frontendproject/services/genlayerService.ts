/**
 * genlayerService.ts
 * ──────────────────
 * Bridge layer between the Next.js frontend and the GenLayer Bradbury testnet.
 *
 * Responsibilities:
 *   1. Read contract state (get_bet, get_open_bets, get_bets_by_address).
 *      GenLayer Python contracts return Python dicts/lists encoded as
 *      hex-wrapped JSON — this service decodes that format.
 *   2. Poll for AI-based transaction finality.
 *      resolve_bet and dispute_bet invoke genlayer.exec_prompt() internally,
 *      which can take 30-120 s. Standard wagmi timeouts are too short.
 *   3. Map raw contract responses to the TypeScript Bet type.
 *
 * Write operations (create_bet, join_bet, etc.) are handled by wagmi's
 * useWriteContract hook — they only need signing, not custom decoding.
 */

import { encodeFunctionData, createPublicClient, http, type Abi } from 'viem'
import { bradburyChain, FAIR_STAKE_ABI, FAIR_STAKE_ADDRESS } from '@/constants'
import type { Bet } from '@/constants/types'
import { BetStatus } from '@/constants'

// ── Constants ──────────────────────────────────────────────────────────────
const RPC_URL             = bradburyChain.rpcUrls.default.http[0]
const GL_POLL_MS          = 3_000   // 3 s between receipt checks
const GL_PENDING_STATE_MS = 15_000  // switch to "ai-processing" toast after 15 s
const GL_TIMEOUT_MS       = 120_000 // 2 min hard timeout for AI transactions

// ── Public viem client (used for getTransactionReceipt polling) ────────────
export const glPublicClient = createPublicClient({
  chain: bradburyChain,
  transport: http(RPC_URL),
  pollingInterval: GL_POLL_MS,
})

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert hex string to UTF-8, stripping null-byte padding. */
function hexToText(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16)
  }
  return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim()
}

/**
 * Decode a GenLayer RPC response.
 *
 * GenLayer serializes Python dicts and lists as JSON and wraps the resulting
 * UTF-8 string in an ABI-encoded `bytes` value:
 *   bytes 0-31  : offset (always 0x20)
 *   bytes 32-63 : byte length of the JSON payload
 *   bytes 64+   : JSON payload (padded to 32-byte boundary)
 *
 * Falls back to raw UTF-8 decode (no length prefix) and finally to
 * BigInt for plain uint256 returns (e.g. get_bet_count).
 */
function decodeGLResponse(hexResult: string): unknown {
  if (!hexResult || hexResult === '0x') return null
  const hex = hexResult.startsWith('0x') ? hexResult.slice(2) : hexResult

  // Strategy 1: ABI-encoded bytes (offset + length + JSON payload)
  if (hex.length >= 128) {
    try {
      const byteLen = parseInt(hex.slice(64, 128), 16)
      const payloadHex = hex.slice(128, 128 + byteLen * 2)
      const text = hexToText(payloadHex)
      if (text.startsWith('{') || text.startsWith('[')) {
        return JSON.parse(text)
      }
    } catch { /* fall through */ }
  }

  // Strategy 2: Raw hex bytes → JSON (no ABI length prefix)
  try {
    const text = hexToText(hex)
    if (text.startsWith('{') || text.startsWith('[')) {
      return JSON.parse(text)
    }
  } catch { /* fall through */ }

  // Strategy 3: Plain uint256 (e.g. get_bet_count)
  try {
    return BigInt('0x' + hex)
  } catch { /* fall through */ }

  return hexResult
}

// ── Core JSON-RPC call ─────────────────────────────────────────────────────

/**
 * Call a view function on the FairStake contract via eth_call.
 * Uses viem's encodeFunctionData for correct ABI encoding of inputs,
 * then decodes the GenLayer-specific response format.
 */
async function glCall(functionName: string, args: unknown[]): Promise<unknown> {
  const data = encodeFunctionData({
    abi: FAIR_STAKE_ABI as Abi,
    functionName,
    args: args as [],
  })

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_call',
      params: [{ to: FAIR_STAKE_ADDRESS, data }, 'latest'],
    }),
  })

  if (!res.ok) {
    throw new Error(`GenLayer RPC HTTP ${res.status}: ${res.statusText}`)
  }

  const json = (await res.json()) as { result?: string; error?: { message: string } }
  if (json.error) {
    throw new Error(json.error.message ?? 'GenLayer RPC error')
  }

  return decodeGLResponse(json.result ?? '0x')
}

// ── Bet mapper ────────────────────────────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

/**
 * Map a raw Python dict (received as parsed JSON) to the TypeScript Bet type.
 * The dict field names use snake_case matching the Python contract.
 */
function mapBet(raw: Record<string, unknown>): Bet {
  const rawStatus = String(raw.status ?? 'OPEN')
  const status: BetStatus = Object.values(BetStatus).includes(rawStatus as BetStatus)
    ? (rawStatus as BetStatus)
    : BetStatus.OPEN

  const rawProposedWinner = raw.proposed_winner
  const proposedWinner: `0x${string}` | null =
    rawProposedWinner && rawProposedWinner !== 'None'
      ? (rawProposedWinner as `0x${string}`)
      : null

  const rawTaker = raw.taker
  const taker: `0x${string}` =
    rawTaker && rawTaker !== 'None'
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
    aiReasoning:    '',   // not stored in contract state; injected from events if needed
    proposedAt:     BigInt(String(raw.proposed_at ?? 0)),
  }
}

// ── Public read API ────────────────────────────────────────────────────────

/** Fetch a single bet by ID. Throws if the bet does not exist. */
export async function fetchBet(betId: number): Promise<Bet> {
  const raw = await glCall('get_bet', [betId])
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Bet #${betId} not found`)
  }
  return mapBet(raw as Record<string, unknown>)
}

/** Fetch all bets with status OPEN (used by the marketplace). */
export async function fetchOpenBets(): Promise<Bet[]> {
  const raw = await glCall('get_open_bets', [])
  if (!Array.isArray(raw)) return []
  return raw.map((r) => mapBet(r as Record<string, unknown>))
}

/** Fetch all bets where `address` is Maker or Taker (My Bets view). */
export async function fetchBetsByAddress(address: string): Promise<Bet[]> {
  const raw = await glCall('get_bets_by_address', [address])
  if (!Array.isArray(raw)) return []
  return raw.map((r) => mapBet(r as Record<string, unknown>))
}

/** Fetch the total number of bets ever created. */
export async function fetchBetCount(): Promise<number> {
  const raw = await glCall('get_bet_count', [])
  return Number(raw ?? 0)
}

// ── AI Transaction Polling ─────────────────────────────────────────────────

export type AITxState = 'idle' | 'pending' | 'ai-processing' | 'finalized' | 'timeout' | 'error'

/**
 * Poll a transaction hash until it has a receipt (finalized on GenLayer).
 *
 * GenLayer AI transactions (resolve_bet, dispute_bet) trigger on-chain AI
 * oracle calls that require validator consensus. This can take 30-120 s,
 * much longer than a standard EVM transaction.
 *
 * @param hash      - Transaction hash returned by wagmi's writeContract
 * @param onState   - Callback invoked when the perceived state changes
 * @returns         - Whether the transaction succeeded
 */
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

    // After ~15 s without receipt, the AI oracle is likely running
    if (attempt * GL_POLL_MS >= GL_PENDING_STATE_MS) {
      onState?.('ai-processing')
    }

    try {
      const receipt = await glPublicClient.getTransactionReceipt({ hash })
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
