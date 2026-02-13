import { create } from 'zustand'

type WalletMetaState = {
    ain: string | null
    ainLoading: boolean
    setAin: (v: string | null) => void
    setAinLoading: (v: boolean) => void
}

export const useWalletMetaStore = create<WalletMetaState>((set) => ({
    ain: null,
    ainLoading: false,
    setAin: (ain) => set({ ain }),
    setAinLoading: (ainLoading) => set({ ainLoading }),
}))
