import { createConfig, http } from 'wagmi'
import { bradburyChain } from '@/constants'
import { getDefaultConfig } from 'connectkit'

export const config = createConfig(
  getDefaultConfig({
    chains: [bradburyChain],
    transports: {
      [bradburyChain.id]: http(),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
    appName: 'FairStake',
    appDescription: 'AI-Powered Decentralized Betting Platform on GenLayer',
    appUrl: 'https://fairstake.app',
    appIcon: 'https://fairstake.app/logo.png',
  })
)

declare module 'wagmi' {
  interface Register {
    config: typeof config
  }
}
