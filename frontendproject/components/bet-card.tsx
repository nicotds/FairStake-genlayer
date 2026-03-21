'use client'

import Link from 'next/link'
import { formatEther } from 'viem'
import { Clock, ExternalLink, Coins } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BetStatus, STATUS_LABELS } from '@/constants'
import type { Bet } from '@/constants/types'
import { cn } from '@/lib/utils'

interface BetCardProps {
  bet: Bet
  onAccept?: () => void
  isAccepting?: boolean
}

const statusStyles: Record<BetStatus, string> = {
  [BetStatus.OPEN]: 'bg-emerald/20 text-emerald border-emerald/30',
  [BetStatus.MATCHED]: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  [BetStatus.PROPOSED]: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  [BetStatus.DISPUTED]: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  [BetStatus.RESOLVED]: 'bg-violet/20 text-violet border-violet/30',
  [BetStatus.CANCELLED]: 'bg-muted text-muted-foreground border-muted',
}

export function BetCard({ bet, onAccept, isAccepting }: BetCardProps) {
  const formattedAmount = parseFloat(formatEther(bet.amount)).toFixed(2)
  const deadlineDate = new Date(Number(bet.deadline) * 1000)
  const isExpired = deadlineDate < new Date()
  const timeLeft = getTimeLeft(deadlineDate)

  return (
    <Card className="group relative overflow-hidden transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
      {/* Glow effect on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet/5" />
      </div>

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold line-clamp-2 leading-snug">
            {bet.criteria.length > 80 ? `${bet.criteria.slice(0, 80)}...` : bet.criteria}
          </CardTitle>
          <Badge 
            variant="outline" 
            className={cn('shrink-0 uppercase text-xs font-semibold', statusStyles[bet.status])}
          >
            {STATUS_LABELS[bet.status]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-3">
        {/* Amount */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Coins className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Stake</p>
            <p className="text-lg font-bold text-primary">{formattedAmount} GEY</p>
          </div>
        </div>

        {/* Deadline */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className={cn('h-4 w-4', isExpired ? 'text-destructive' : 'text-muted-foreground')} />
          <span className={cn(isExpired ? 'text-destructive' : 'text-muted-foreground')}>
            {isExpired ? 'Expirado' : timeLeft}
          </span>
        </div>

        {/* Source URL */}
        {bet.sourceUrl && (
          <a
            href={bet.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors truncate"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="truncate">{new URL(bet.sourceUrl).hostname}</span>
          </a>
        )}
      </CardContent>

      <CardFooter className="pt-0">
        {bet.status === BetStatus.OPEN && onAccept ? (
          <Button 
            onClick={onAccept} 
            disabled={isAccepting || isExpired}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isAccepting ? 'Aceptando...' : 'Aceptar Desafio'}
          </Button>
        ) : bet.status === BetStatus.PROPOSED ? (
          <Button asChild variant="secondary" className="w-full">
            <Link href={`/bet/${bet.id.toString()}`}>Ver Veredicto</Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="w-full">
            <Link href={`/bet/${bet.id.toString()}`}>Ver Detalles</Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function getTimeLeft(deadline: Date): string {
  const now = new Date()
  const diff = deadline.getTime() - now.getTime()
  
  if (diff <= 0) return 'Expirado'
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (days > 0) return `${days}d ${hours}h restantes`
  if (hours > 0) return `${hours}h ${minutes}m restantes`
  return `${minutes}m restantes`
}
