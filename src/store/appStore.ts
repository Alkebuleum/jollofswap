import { create } from 'zustand'

type AppState = {
  walletConnected: boolean
  address?: string
  connectWallet: () => void
}

export const useAppStore = create<AppState>((set)=> ({
  walletConnected: false,
  connectWallet: () => set({ walletConnected: true, address: '0xAmVaultMocked...' })
}))
