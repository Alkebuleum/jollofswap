import { create } from 'zustand'

type ConnectModalStore = {
  open: boolean
  openModal: () => void
  closeModal: () => void
}

export const useConnectModalStore = create<ConnectModalStore>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}))
