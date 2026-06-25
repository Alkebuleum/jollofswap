import { create } from 'zustand'

type WcState = {
  wcConnected: boolean
  wcAddress: string | null  // primary address = aaWallet (for balance display)
  signer: string | null     // EOA that signs transactions
  setWcState: (connected: boolean, address: string | null, signer?: string | null) => void
}

export const useWcStore = create<WcState>((set) => ({
  wcConnected: false,
  wcAddress: null,
  signer: null,
  setWcState: (wcConnected, wcAddress, signer) =>
    set({ wcConnected, wcAddress, signer: signer ?? null }),
}))
