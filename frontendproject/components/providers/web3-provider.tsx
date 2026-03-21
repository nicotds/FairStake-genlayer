'use client'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { config } from '@/lib/wagmi'
import { useState, type ReactNode } from 'react'

interface Web3ProviderProps {
  children: ReactNode
}

export function Web3Provider({ children }: Web3ProviderProps) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode="dark"
          customTheme={{
            '--ck-font-family': 'var(--font-sans)',
            '--ck-accent-color': '#10b981',
            '--ck-accent-text-color': '#000000',
            '--ck-body-background': '#09090b',
            '--ck-body-color': '#fafafa',
            '--ck-primary-button-background': '#10b981',
            '--ck-primary-button-color': '#000000',
            '--ck-secondary-button-background': '#18181b',
            '--ck-secondary-button-color': '#fafafa',
            '--ck-connectbutton-background': '#18181b',
            '--ck-connectbutton-color': '#fafafa',
            '--ck-connectbutton-hover-background': '#27272a',
          }}
        >
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
