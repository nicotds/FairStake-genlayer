'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface CountdownTimerProps {
  targetTime: number // Unix timestamp in seconds
  onExpire?: () => void
  className?: string
}

export function CountdownTimer({ targetTime, onExpire, className }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [isExpired, setIsExpired] = useState(false)

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Math.floor(Date.now() / 1000)
      const remaining = targetTime - now
      
      if (remaining <= 0) {
        setIsExpired(true)
        setTimeLeft(0)
        onExpire?.()
        return 0
      }
      
      return remaining
    }

    setTimeLeft(calculateTimeLeft())

    const timer = setInterval(() => {
      const remaining = calculateTimeLeft()
      setTimeLeft(remaining)
      
      if (remaining <= 0) {
        clearInterval(timer)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [targetTime, onExpire])

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  const isUrgent = timeLeft > 0 && timeLeft <= 60

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        className={cn(
          'flex items-center justify-center gap-1 rounded-lg px-4 py-3 font-mono text-2xl font-bold transition-all',
          isExpired
            ? 'bg-muted text-muted-foreground'
            : isUrgent
              ? 'bg-destructive/20 text-destructive pulse-ring'
              : 'bg-yellow-500/20 text-yellow-400'
        )}
      >
        <span className="min-w-[2ch] text-center">{String(minutes).padStart(2, '0')}</span>
        <span className="animate-pulse">:</span>
        <span className="min-w-[2ch] text-center">{String(seconds).padStart(2, '0')}</span>
      </div>
      <p className={cn(
        'text-sm',
        isExpired ? 'text-muted-foreground' : isUrgent ? 'text-destructive' : 'text-yellow-400'
      )}>
        {isExpired ? 'Ventana de disputa cerrada' : 'Tiempo restante para disputar'}
      </p>
    </div>
  )
}
