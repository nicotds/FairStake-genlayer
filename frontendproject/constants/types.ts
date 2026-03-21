import { type BetStatus } from './index'

export interface Bet {
  id: bigint
  maker: `0x${string}`
  /** Zero address ('0x000...000') when no Taker has joined yet */
  taker: `0x${string}`
  criteria: string
  sourceUrl: string
  amount: bigint
  deadline: bigint
  status: BetStatus
  /**
   * Address of the AI-proposed winner (null until resolve_bet is called).
   * Was `winner` — renamed to match the contract field `proposed_winner`.
   */
  proposedWinner: `0x${string}` | null
  /**
   * AI reasoning text extracted from the BetResolved event.
   * Empty string when the bet has not been resolved yet.
   */
  aiReasoning: string
  proposedAt: bigint
}

export interface CreateBetParams {
  sourceUrl: string   // source_url is the FIRST param in create_bet()
  criteria: string
  deadline: number    // Unix timestamp
  amount: string      // GEY as decimal string (e.g. "1.5"), converted to wei in the hook
}

export interface AISimulationResult {
  understood: boolean
  reasoning: string
}

export type FilterType = 'all' | 'my-bets' | 'open'
