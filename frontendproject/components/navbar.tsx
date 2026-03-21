'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAccount, useBalance } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Search, Zap } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { bradburyChain } from '@/constants'

export function Navbar() {
  const [searchId, setSearchId] = useState('')
  const { address, isConnected } = useAccount()
  const { data: balance } = useBalance({
    address,
    chainId: bradburyChain.id,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchId.trim()) {
      window.location.href = `/bet/${searchId}`
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            Fair<span className="text-primary">Stake</span>
          </span>
        </Link>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-md mx-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por ID de apuesta..."
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              className="pl-10 bg-secondary/50 border-border/50 focus:bg-background"
            />
          </div>
        </form>

        {/* Connect Wallet & Balance */}
        <div className="flex items-center gap-3 shrink-0">
          {isConnected && balance && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/50">
              <span className="text-sm text-muted-foreground">Balance:</span>
              <span className="text-sm font-semibold text-primary">
                {parseFloat(balance.formatted).toFixed(4)} {balance.symbol}
              </span>
            </div>
          )}
          <ConnectKitButton.Custom>
            {({ isConnected, isConnecting, show, address, ensName }) => (
              <Button
                onClick={show}
                variant={isConnected ? 'outline' : 'default'}
                className={isConnected ? 'bg-secondary/50' : 'bg-primary text-primary-foreground hover:bg-primary/90'}
              >
                {isConnecting ? (
                  'Conectando...'
                ) : isConnected ? (
                  ensName || `${address?.slice(0, 6)}...${address?.slice(-4)}`
                ) : (
                  'Conectar Wallet'
                )}
              </Button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </header>
  )
}
