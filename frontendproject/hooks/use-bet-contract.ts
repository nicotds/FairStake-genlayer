'use client'

import { useWriteContract, useReadContract } from 'wagmi'
import { parseEther } from 'viem'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { FAIR_STAKE_ABI, FAIR_STAKE_ADDRESS } from '@/constants'
import {
  fetchBet,
  fetchOpenBets,
  fetchBetsByAddress,
  waitForAITransaction,
  type AITxState,
} from '@/services/genlayerService'
import type { Bet, CreateBetParams } from '@/constants/types'

// ── Write hook (wagmi handles signing + broadcasting) ─────────────────────
export function useBetContract() {
  const { writeContractAsync, isPending: isWriting, error: writeError } = useWriteContract()
  const queryClient = useQueryClient()
  const [aiTxState, setAiTxState] = useState<AITxState>('idle')

  // ── create_bet ───────────────────────────────────────────────────────────
  // Contract signature: create_bet(source_url, criteria, deadline)
  // source_url is the FIRST parameter — do NOT swap the order.
  const createBet = useCallback(async (params: CreateBetParams): Promise<`0x${string}`> => {
    const hash = await writeContractAsync({
      address: FAIR_STAKE_ADDRESS,
      abi: FAIR_STAKE_ABI,
      functionName: 'create_bet',
      args: [
        params.sourceUrl,               // ← source_url FIRST (matches Python contract)
        params.criteria,
        BigInt(params.deadline),
      ],
      value: parseEther(params.amount),
    })
    void queryClient.invalidateQueries({ queryKey: ['open-bets'] })
    return hash
  }, [writeContractAsync, queryClient])

  // ── join_bet (was: accept_bet — wrong name) ──────────────────────────────
  const joinBet = useCallback(async (betId: bigint, amountEther: string): Promise<`0x${string}`> => {
    const hash = await writeContractAsync({
      address: FAIR_STAKE_ADDRESS,
      abi: FAIR_STAKE_ABI,
      functionName: 'join_bet',
      args: [betId],
      value: parseEther(amountEther),
    })
    void queryClient.invalidateQueries({ queryKey: ['open-bets'] })
    void queryClient.invalidateQueries({ queryKey: ['bet', betId.toString()] })
    return hash
  }, [writeContractAsync, queryClient])

  // ── resolve_bet (was: propose_outcome — wrong name) ──────────────────────
  // This is an AI transaction: triggers genlayer.exec_prompt() internally.
  // Use waitForAITransaction instead of standard wagmi receipt polling.
  const resolveBet = useCallback(async (
    betId: bigint,
    onState?: (s: AITxState) => void,
  ): Promise<boolean> => {
    setAiTxState('pending')
    const hash = await writeContractAsync({
      address: FAIR_STAKE_ADDRESS,
      abi: FAIR_STAKE_ABI,
      functionName: 'resolve_bet',
      args: [betId],
    })
    const cb = (s: AITxState) => { setAiTxState(s); onState?.(s) }
    const success = await waitForAITransaction(hash, cb)
    if (success) {
      void queryClient.invalidateQueries({ queryKey: ['bet', betId.toString()] })
    }
    return success
  }, [writeContractAsync, queryClient])

  // ── dispute_bet (was: dispute — wrong name) ──────────────────────────────
  // Also an AI transaction (Democracy Phase with 3 validators).
  const disputeBet = useCallback(async (
    betId: bigint,
    onState?: (s: AITxState) => void,
  ): Promise<boolean> => {
    setAiTxState('pending')
    const hash = await writeContractAsync({
      address: FAIR_STAKE_ADDRESS,
      abi: FAIR_STAKE_ABI,
      functionName: 'dispute_bet',
      args: [betId],
    })
    const cb = (s: AITxState) => { setAiTxState(s); onState?.(s) }
    const success = await waitForAITransaction(hash, cb)
    if (success) {
      void queryClient.invalidateQueries({ queryKey: ['bet', betId.toString()] })
    }
    return success
  }, [writeContractAsync, queryClient])

  // ── claim_prize (was: claim_rewards — wrong name) ────────────────────────
  const claimPrize = useCallback(async (betId: bigint): Promise<`0x${string}`> => {
    const hash = await writeContractAsync({
      address: FAIR_STAKE_ADDRESS,
      abi: FAIR_STAKE_ABI,
      functionName: 'claim_prize',
      args: [betId],
    })
    void queryClient.invalidateQueries({ queryKey: ['bet', betId.toString()] })
    return hash
  }, [writeContractAsync, queryClient])

  return {
    createBet,
    joinBet,
    resolveBet,
    disputeBet,
    claimPrize,
    isWriting,
    aiTxState,
    writeError,
  }
}

// ── Read hooks (backed by genlayerService — handles GenLayer JSON encoding) ─

/**
 * Fetch a single bet from the contract.
 * Refetches every 5 s so PROPOSED/DISPUTED state changes appear automatically.
 */
export function useGetBet(betId: string | undefined) {
  return useQuery<Bet, Error>({
    queryKey: ['bet', betId],
    queryFn: () => fetchBet(parseInt(betId!)),
    enabled: !!betId,
    refetchInterval: 5_000,
    staleTime: 3_000,
  })
}

/**
 * Fetch all OPEN bets for the marketplace.
 * Refetches every 10 s to show newly created bets.
 */
export function useGetOpenBets() {
  return useQuery<Bet[], Error>({
    queryKey: ['open-bets'],
    queryFn: fetchOpenBets,
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
}

/**
 * Fetch all bets where the connected wallet is Maker or Taker.
 */
export function useGetBetsByAddress(address: string | undefined) {
  return useQuery<Bet[], Error>({
    queryKey: ['my-bets', address],
    queryFn: () => fetchBetsByAddress(address!),
    enabled: !!address,
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
}

/**
 * Fetch total bet count via wagmi (simple uint256 — no JSON decoding needed).
 */
export function useGetBetCount() {
  return useReadContract({
    address: FAIR_STAKE_ADDRESS,
    abi: FAIR_STAKE_ABI,
    functionName: 'get_bet_count',
  })
}
