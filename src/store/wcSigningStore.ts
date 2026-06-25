// src/store/wcSigningStore.ts
//
// Tracks in-progress Nuru QR signing flows.
//
// Step 1 = QR code shown (user scans with Nuru to approve).
// Step 2+ = updated QR for the next signing step in a multi-step flow.
// Each step carries its own qrPayload so WcSigningModal always shows the current QR.

import { create } from 'zustand'

interface WcSigningState {
  active: boolean
  label: string
  step: number
  total: number      // total signing steps in this flow (0 = unknown/single)
  qrPayload: string  // flowId for the current step
  begin(qrPayload: string, label: string, total?: number): void
  next(qrPayload: string): void
  done(): void
}

export const useWcSigningStore = create<WcSigningState>((set) => ({
  active: false,
  label: '',
  step: 0,
  total: 0,
  qrPayload: '',
  begin: (qrPayload, label, total = 0) => set({ active: true, qrPayload, label, step: 1, total }),
  next:  (qrPayload)                   => set((s) => ({ step: s.step + 1, qrPayload })),
  done:  ()                            => set({ active: false, step: 0, total: 0, qrPayload: '' }),
}))
