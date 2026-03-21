'use client'

import { Bot, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AIReasoningDisplayProps {
  reasoning: string
  className?: string
}

export function AIReasoningDisplay({ reasoning, className }: AIReasoningDisplayProps) {
  if (!reasoning) return null

  return (
    <div className={cn('terminal-text rounded-lg overflow-hidden', className)}>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-violet/20 bg-violet/10">
        <Bot className="h-4 w-4 text-violet" />
        <span className="text-sm font-mono font-semibold text-violet">
          IA Analysis
        </span>
        <div className="ml-auto flex gap-1">
          <div className="h-2 w-2 rounded-full bg-emerald animate-pulse" />
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {reasoning}
          </p>
        </div>
      </div>
    </div>
  )
}
