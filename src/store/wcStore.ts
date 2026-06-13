import { create } from 'zustand'

type WcState = {
  wcConnected: boolean
  wcAddress: string | null
  setWcState: (connected: boolean, address: string | null) => void
}

export const useWcStore = create<WcState>((set) => ({
  wcConnected: false,
  wcAddress: null,
  setWcState: (wcConnected, wcAddress) => set({ wcConnected, wcAddress }),
}))
