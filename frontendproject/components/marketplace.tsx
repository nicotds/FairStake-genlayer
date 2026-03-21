'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { Plus, Loader2, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BetCard } from '@/components/bet-card'
import { MarketplaceFilters } from '@/components/marketplace-filters'
import { useBetContract, useGetOpenBets, useGetBetsByAddress } from '@/hooks/use-bet-contract'
import { BetStatus } from '@/constants'
import type { Bet, FilterType } from '@/constants/types'
import { toast } from 'sonner'
import { formatEther } from 'viem'
import { txToast } from '@/hooks/use-transaction-toast'

export function Marketplace() {
  const [filter, setFilter] = useState<FilterType>('all')
  const [joiningBetId, setJoiningBetId] = useState<bigint | null>(null)
  const { address, isConnected } = useAccount()
  const { joinBet, isWriting } = useBetContract()

  // ── Live contract data ───────────────────────────────────────────────────
  const {
    data: openBets = [],
    isLoading: isLoadingOpen,
    error: openError,
    refetch: refetchOpen,
  } = useGetOpenBets()

  const {
    data: myBets = [],
    isLoading: isLoadingMine,
    error: myError,
  } = useGetBetsByAddress(address)

  const isLoading = filter === 'my-bets' ? isLoadingMine : isLoadingOpen
  const hasError  = filter === 'my-bets' ? !!myError : !!openError

  // ── Filter logic ─────────────────────────────────────────────────────────
  const filteredBets: Bet[] = useMemo(() => {
    switch (filter) {
      case 'open':
        return openBets.filter((b) => b.status === BetStatus.OPEN)
      case 'my-bets':
        return myBets
      default:
        // 'all': merge open bets + my bets (dedup by id)
        const seen = new Set<string>()
        return [...openBets, ...myBets].filter((b) => {
          const key = b.id.toString()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
    }
  }, [openBets, myBets, filter])

  // ── Join bet handler ──────────────────────────────────────────────────────
  const handleJoinBet = async (bet: Bet) => {
    if (!isConnected) {
      toast.error('Conecta tu wallet para aceptar el desafio')
      return
    }
    if (address?.toLowerCase() === bet.maker.toLowerCase()) {
      toast.error('No puedes aceptar tu propio desafio')
      return
    }

    setJoiningBetId(bet.id)
    txToast.signing('join-bet')

    try {
      await joinBet(bet.id, formatEther(bet.amount))
      txToast.pending('join-bet')
      txToast.success('join-bet', 'Desafio aceptado! Apuesta en progreso.')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('msg.value must match')) {
        txToast.error('join-bet', 'El monto enviado no coincide con el stake requerido')
      } else if (msg.includes('deadline')) {
        txToast.error('join-bet', 'La fecha limite de esta apuesta ya paso')
      } else {
        txToast.error('join-bet', 'Error al aceptar la apuesta')
      }
    } finally {
      setJoiningBetId(null)
    }
  }

  // ── Stats (from open bets as baseline) ───────────────────────────────────
  const totalOpen    = openBets.filter((b) => b.status === BetStatus.OPEN).length
  const totalSettled = openBets.filter((b) => b.status === BetStatus.SETTLED).length

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col gap-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
            <p className="text-muted-foreground mt-1">
              Explora y acepta desafios verificados por IA
            </p>
          </div>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
            <Link href="/create">
              <Plus className="h-4 w-4" />
              Crear Desafio
            </Link>
          </Button>
        </div>

        <MarketplaceFilters
          activeFilter={filter}
          onFilterChange={setFilter}
          isConnected={isConnected}
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Cargando apuestas desde Bradbury...</span>
        </div>
      )}

      {/* Error state */}
      {!isLoading && hasError && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <p className="text-muted-foreground">No se pudo conectar con la red Bradbury</p>
          <Button variant="outline" onClick={() => refetchOpen()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </Button>
        </div>
      )}

      {/* Bets Grid */}
      {!isLoading && !hasError && (
        filteredBets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No hay apuestas</h3>
            <p className="text-muted-foreground mb-4">
              {filter === 'my-bets'
                ? 'Aun no has participado en ninguna apuesta'
                : 'Se el primero en crear un desafio'}
            </p>
            <Button asChild className="bg-primary text-primary-foreground">
              <Link href="/create">Crear Desafio</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBets.map((bet) => (
              <BetCard
                key={bet.id.toString()}
                bet={bet}
                onAccept={() => handleJoinBet(bet)}
                isAccepting={joiningBetId === bet.id && isWriting}
              />
            ))}
          </div>
        )
      )}

      {/* Stats Footer */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-8 py-6 border-t border-border/50">
        <div className="text-center">
          <p className="text-2xl font-bold text-primary">{openBets.length}</p>
          <p className="text-sm text-muted-foreground">Total Apuestas</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-emerald">{totalOpen}</p>
          <p className="text-sm text-muted-foreground">Abiertas</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-violet">{totalSettled}</p>
          <p className="text-sm text-muted-foreground">Resueltas</p>
        </div>
      </div>
    </div>
  )
}
