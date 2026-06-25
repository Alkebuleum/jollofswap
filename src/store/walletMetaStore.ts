import { create } from 'zustand'

type WalletMetaState = {
  ain: string | null
  ainLoading: boolean
  aaWallet: string | null
  primaryHandle: string | null
  setAin: (v: string | null) => void
  setAinLoading: (v: boolean) => void
  setAaWallet: (v: string | null) => void
  setPrimaryHandle: (v: string | null) => void
}

export const useWalletMetaStore = create<WalletMetaState>((set) => ({
  ain: null,
  ainLoading: false,
  aaWallet: null,
  primaryHandle: null,
  setAin:           (ain)           => set({ ain }),
  setAinLoading:    (ainLoading)    => set({ ainLoading }),
  setAaWallet:      (aaWallet)      => set({ aaWallet }),
  setPrimaryHandle: (primaryHandle) => set({ primaryHandle }),
}))
