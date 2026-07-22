// src/lib/bridge/persistence.ts
//
// Local persistence of the single active bridge transaction, keyed by source
// tx hash, so a page refresh restores in-flight progress (ALKEBRIDGE.md §12).
// Only non-sensitive fields are stored. Cleared only on COMPLETED or explicit
// user dismissal of an operator-attention record — never on a browser
// timeout, network error, or 404 awaiting_detection response.

import type { BridgeDirection } from './config'

const STORAGE_KEY = 'jswap:bridge:active_tx'

export type StoredBridgeTransaction = {
  direction: BridgeDirection
  sourceTransactionHash: string
  amountRaw: string
  destinationAddress: string
  submittedAt: number
  // Only meaningful for burn-to-release (BNB → Alkebuleum). Absent/false
  // means the backend hasn't confirmed POST /register yet, so a reload must
  // resume retrying registration rather than asking the user to burn again.
  registrationComplete?: boolean
}

export function readActiveBridgeTx(): StoredBridgeTransaction | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.sourceTransactionHash !== 'string') return null
    return parsed as StoredBridgeTransaction
  } catch {
    return null
  }
}

export function writeActiveBridgeTx(tx: StoredBridgeTransaction) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tx))
  } catch {
    // best-effort; a failed write just means no restore-on-refresh
  }
}

export function clearActiveBridgeTx() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

// Flips registrationComplete on the stored record without disturbing the
// rest of it — a no-op if the active record has since moved on to a
// different source tx hash.
export function markActiveBridgeTxRegistered(sourceTransactionHash: string) {
  const stored = readActiveBridgeTx()
  if (!stored || stored.sourceTransactionHash !== sourceTransactionHash) return
  writeActiveBridgeTx({ ...stored, registrationComplete: true })
}
