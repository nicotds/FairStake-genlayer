'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import confetti from 'canvas-confetti'
import {
  ArrowLeft,
  Clock,
  Coins,
  ExternalLink,
  User,
  AlertTriangle,
  Trophy,
  Loader2,
  Shield,
  Bot,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { CountdownTimer } from '@/components/countdown-timer'
import { AIReasoningDisplay } from '@/components/ai-reasoning-display'
import { useBetContract, useGetBet } from '@/hooks/use-bet-contract'
import { txToast } from '@/hooks/use-transaction-toast'
import { BetStatus, STATUS_LABELS, DISPUTE_WINDOW_SECONDS } from '@/constants'
import type { BetStatus as BetStatusType } from '@/constants'
import { cn } from '@/lib/utils'

interface BetDetailProps {
  betId: string
}

const statusStyles: Record<BetStatusType, string> = {
  OPEN:      'bg-emerald/20 text-emerald border-emerald/30',
  MATCHED:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PROPOSED:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  DISPUTED:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
  SETTLED:   'bg-violet/20 text-violet border-violet/30',       // was: RESOLVED (wrong)
  CANCELLED: 'bg-muted text-muted-foreground border-muted',
}

export function BetDetail({ betId }: BetDetailProps) {
  const { address, isConnected } = useAccount()
  const { joinBet, resolveBet, disputeBet, claimPrize, isWriting } = useBetContract()
  const [isActing, setIsActing]       = useState(false)
  const [disputeExpired, setDisputeExpired] = useState(false)

  // ── Live contract data (refetches every 5 s) ─────────────────────────────
  const { data: bet, isLoading, error, refetch } = useGetBet(betId)

  // ── Toast for CANCELLED bets (invalid AI verdict → both refunded) ─────────
  useEffect(() => {
    if (bet?.status === BetStatus.CANCELLED) {
      txToast.error(
        'bet-cancelled',
        'Apuesta Cancelada — Fondos Reembolsados a ambas partes',
      )
    }
  }, [bet?.status])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Button asChild variant="ghost" className="mb-6 -ml-2">
          <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Volver al Marketplace</Link>
        </Button>
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Cargando apuesta #{betId}...</span>
        </div>
      </div>
    )
  }

  if (error || !bet) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <Button asChild variant="ghost" className="mb-6 -ml-2">
          <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Volver al Marketplace</Link>
        </Button>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-muted-foreground">No se encontro la apuesta #{betId}</p>
          <Button variant="outline" onClick={() => refetch()}>Reintentar</Button>
        </div>
      </div>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const formattedAmount  = parseFloat(formatEther(bet.amount)).toFixed(2)
  const totalPot         = parseFloat(formatEther(bet.amount * BigInt(2))).toFixed(2)
  const deadlineDate     = new Date(Number(bet.deadline) * 1000)
  const disputeDeadline  = Number(bet.proposedAt) + DISPUTE_WINDOW_SECONDS
  const nowSecs          = Math.floor(Date.now() / 1000)
  const pastDeadline     = nowSecs >= Number(bet.deadline)
  const disputeWindowExpired = nowSecs >= disputeDeadline

  const ZERO = '0x0000000000000000000000000000000000000000'
  const isUserMaker       = !!address && address.toLowerCase() === bet.maker.toLowerCase()
  const isUserTaker       = !!address && bet.taker !== ZERO && address.toLowerCase() === bet.taker.toLowerCase()
  const isUserParticipant = isUserMaker || isUserTaker
  // proposedWinner is who the AI said won (replaces the old `winner` field)
  const isUserWinner      = !!address && !!bet.proposedWinner &&
                            address.toLowerCase() === bet.proposedWinner.toLowerCase()

  const canJoin    = isConnected && !isUserMaker && bet.status === BetStatus.OPEN && !pastDeadline
  const canResolve = isConnected && bet.status === BetStatus.MATCHED && pastDeadline
  const canDispute = isConnected && isUserParticipant && bet.status === BetStatus.PROPOSED && !disputeExpired && !disputeWindowExpired
  // claim_prize: status PROPOSED + window expired (happy path — no dispute filed)
  const canClaim   = isConnected && bet.status === BetStatus.PROPOSED && disputeWindowExpired

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleJoinBet = async () => {
    setIsActing(true)
    txToast.signing('join')
    try {
      await joinBet(bet.id, formatEther(bet.amount))
      txToast.pending('join')
      txToast.success('join', 'Desafio aceptado!')
      void refetch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      txToast.error('join', msg.includes('msg.value') ? 'El monto no coincide con el stake' : 'Error al aceptar')
    } finally { setIsActing(false) }
  }

  const handleResolveBet = async () => {
    setIsActing(true)
    txToast.signing('resolve')
    try {
      const ok = await resolveBet(bet.id, (s) => {
        if (s === 'pending')        txToast.pending('resolve')
        if (s === 'ai-processing')  txToast.aiProcessing('resolve')
        if (s === 'finalized')      txToast.success('resolve', 'Apuesta resuelta por la IA')
        if (s === 'error')          txToast.error('resolve', 'Error en la resolucion')
        if (s === 'timeout')        txToast.error('resolve', 'Tiempo de espera agotado — reintenta')
      })
      if (ok) void refetch()
    } catch { txToast.error('resolve', 'Error al resolver la apuesta') }
    finally  { setIsActing(false) }
  }

  const handleDisputeBet = async () => {
    setIsActing(true)
    txToast.signing('dispute')
    try {
      const ok = await disputeBet(bet.id, (s) => {
        if (s === 'pending')        txToast.pending('dispute')
        if (s === 'ai-processing')  txToast.aiProcessing('dispute')
        if (s === 'finalized')      txToast.success('dispute', 'Democracia completada — veredicto final aplicado')
        if (s === 'error')          txToast.error('dispute', 'Error en la disputa')
        if (s === 'timeout')        txToast.error('dispute', 'Tiempo de espera agotado — reintenta')
      })
      if (ok) void refetch()
    } catch { txToast.error('dispute', 'Error al enviar la disputa') }
    finally  { setIsActing(false) }
  }

  const handleClaimPrize = async () => {
    setIsActing(true)
    txToast.signing('claim')
    try {
      await claimPrize(bet.id)
      txToast.success('claim', 'Victoria! Fondos reclamados.')
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#10b981', '#8b5cf6', '#fbbf24'] })
      void refetch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('Dispute window has not expired')) {
        txToast.error('claim', 'La ventana de disputa aun no ha expirado')
      } else {
        txToast.error('claim', 'Error al reclamar los fondos')
      }
    } finally { setIsActing(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Button asChild variant="ghost" className="mb-6 -ml-2">
        <Link href="/">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver al Marketplace
        </Link>
      </Button>

      <div className="space-y-6">
        {/* Header Card */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">ID: {betId}</span>
                  <Badge
                    variant="outline"
                    className={cn('uppercase text-xs font-semibold', statusStyles[bet.status])}
                  >
                    {STATUS_LABELS[bet.status]}
                  </Badge>
                </div>
                <CardTitle className="text-xl leading-relaxed">{bet.criteria}</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Coins className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stake</p>
                  <p className="text-lg font-bold text-primary">{formattedAmount} GEY</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/10">
                  <Trophy className="h-5 w-5 text-violet" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pot Total</p>
                  <p className="text-lg font-bold text-violet">{totalPot} GEY</p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Fecha limite:</span>
                <span>{deadlineDate.toLocaleDateString('es-ES', { dateStyle: 'medium' })}</span>
              </div>
              <div className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Fuente:</span>
                <a
                  href={bet.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline truncate"
                >
                  {new URL(bet.sourceUrl).hostname}
                </a>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Maker:</span>
                <span className="font-mono text-xs">
                  {bet.maker.slice(0, 6)}...{bet.maker.slice(-4)}
                  {isUserMaker && <Badge variant="secondary" className="ml-1 text-xs">Tu</Badge>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Taker:</span>
                <span className="font-mono text-xs">
                  {bet.taker === ZERO
                    ? 'Pendiente'
                    : `${bet.taker.slice(0, 6)}...${bet.taker.slice(-4)}`}
                  {isUserTaker && <Badge variant="secondary" className="ml-1 text-xs">Tu</Badge>}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Reasoning (shown once the bet has been resolved by the oracle) */}
        {bet.aiReasoning && <AIReasoningDisplay reasoning={bet.aiReasoning} />}

        {/* CANCELLED notice — invalid AI verdict, funds already refunded */}
        {bet.status === BetStatus.CANCELLED && (
          <Card className="border-muted">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Apuesta Cancelada — Fondos Reembolsados
              </CardTitle>
              <CardDescription>
                La IA no pudo verificar el criterio (URL inaccesible o criterio ambiguo).
                Ambas partes recibieron su stake de vuelta automaticamente.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Resolve bet — available to anyone once deadline passes and bet is MATCHED */}
        {canResolve && (
          <Card className="border-blue-500/30">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-400" />
                Resolver con IA
              </CardTitle>
              <CardDescription>
                La fecha limite paso. Cualquiera puede activar el oraculo de IA para determinar el ganador.
                Este proceso puede tardar 30-120 segundos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleResolveBet}
                disabled={isActing || isWriting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isActing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Consultando IA...</>
                ) : (
                  <><Bot className="mr-2 h-4 w-4" />Activar Oraculo de IA</>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Dispute Window — only visible to participants during the 5-min window */}
        {bet.status === BetStatus.PROPOSED && isUserParticipant && (
          <Card className="border-yellow-500/30">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                Ventana de Disputa
              </CardTitle>
              <CardDescription>
                Si no estas de acuerdo con el veredicto de la IA, puedes disputar antes de que expire el tiempo.
                La Democracia (3 nodos) tomara el control.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <CountdownTimer
                targetTime={disputeDeadline}
                onExpire={() => setDisputeExpired(true)}
              />
              <Button
                onClick={handleDisputeBet}
                disabled={!canDispute || isActing || isWriting}
                variant="destructive"
                className="w-full max-w-xs"
              >
                {isActing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />La IA esta deliberando...</>
                ) : (
                  <><Shield className="mr-2 h-4 w-4" />Disputar Veredicto</>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Claim Prize — happy path: PROPOSED + 5 min elapsed, no dispute */}
        {canClaim && (
          <Card className="border-emerald/30 glow-emerald">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2 text-emerald">
                <Trophy className="h-5 w-5" />
                {isUserWinner ? 'Felicitaciones, ganaste!' : 'Reclamar Premio'}
              </CardTitle>
              <CardDescription>
                La ventana de disputa expiro sin impugnaciones.
                {bet.proposedWinner && (
                  <> Ganador propuesto: <span className="font-mono">{bet.proposedWinner.slice(0, 6)}...{bet.proposedWinner.slice(-4)}</span></>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleClaimPrize}
                disabled={isActing || isWriting}
                className="w-full bg-emerald text-black hover:bg-emerald/90"
              >
                {isActing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reclamando...</>
                ) : (
                  <><Coins className="mr-2 h-4 w-4" />Reclamar {totalPot} GEY</>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Join bet — for OPEN bets, non-makers */}
        {bet.status === BetStatus.OPEN && !isUserMaker && (
          <Card>
            <CardContent className="pt-6">
              <Button
                onClick={handleJoinBet}
                disabled={!canJoin || isActing || isWriting}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isActing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aceptando...</>
                ) : (
                  <><Coins className="mr-2 h-4 w-4" />Aceptar Desafio ({formattedAmount} GEY)</>
                )}
              </Button>
              {!isConnected && (
                <p className="text-center text-sm text-muted-foreground mt-2">
                  Conecta tu wallet para aceptar este desafio
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
