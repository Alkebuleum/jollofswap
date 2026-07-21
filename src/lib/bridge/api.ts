// src/lib/bridge/api.ts
//
// Read-only status/history client for the ALKE bridge backend. Mirrors
// src/lib/bridgeApi.ts's shape/error-handling conventions. The backend
// remains the authoritative source for bridge state — this is polling, not
// a source of truth the frontend derives independently (ALKEBRIDGE.md §10/§13).

import { BRIDGE_API } from './config'
import type { BridgeDirection } from './config'

export type BridgeTransactionStatus = {
  id: string
  direction: BridgeDirection
  state: string
  sourceTransactionHash: string
  destinationTransactionHash?: string | null
  sourceChainId: number
  destinationChainId: number
  sourceContract: string
  destinationContract: string
  rawSourceAmount: string
  sourceDecimals: number
  sourceSender: string
  destinationAddress: string
  confirmationCount: number
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  createdAt: number
  updatedAt: number
  completedAt?: number | null
}

export type StatusResult =
  | { found: true; transaction: BridgeTransactionStatus }
  | { found: false; status: 'awaiting_detection'; message: string }

export class InvalidTransactionHashError extends Error {
  constructor() {
    super('invalid_transaction_hash')
    this.name = 'InvalidTransactionHashError'
  }
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

export async function fetchAlkeBridgeStatus(sourceTransactionHash: string): Promise<StatusResult> {
  if (!TX_HASH_RE.test(sourceTransactionHash)) {
    throw new InvalidTransactionHashError()
  }
  const r = await fetch(`${BRIDGE_API}/v1/alke-bridge/status/${sourceTransactionHash}`)
  if (r.status === 404) {
    const body = await r.json().catch(() => null)
    if (body && body.found === false) return body as StatusResult
    return { found: false, status: 'awaiting_detection', message: 'The source transaction has not been detected by the bridge worker yet.' }
  }
  if (!r.ok) throw new Error(`alke-bridge-api ${r.status}`)
  return r.json()
}

export async function fetchAlkeBridgeHistory(wallet: string, limit = 20): Promise<BridgeTransactionStatus[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50))
  const r = await fetch(`${BRIDGE_API}/v1/alke-bridge/history?wallet=${encodeURIComponent(wallet)}&limit=${boundedLimit}`)
  if (!r.ok) throw new Error(`alke-bridge-api ${r.status}`)
  const body = await r.json()
  return body.transactions ?? []
}

// ── Polling state classification (ALKEBRIDGE.md §10/§11) ────────────────

const TERMINAL_SUCCESS_STATES = new Set(['COMPLETED'])

const OPERATOR_ATTENTION_STATES = new Set([
  'FAILED_PERMANENT',
  'MANUAL_REVIEW',
  'RECONCILIATION_REQUIRED',
  'PAUSED_BACKING_MISMATCH',
  'PAUSED_CAPACITY_EXCEEDED',
  'PAUSED_INSUFFICIENT_LOCKED_BACKING',
])

export function isTerminalSuccess(state: string): boolean {
  return TERMINAL_SUCCESS_STATES.has(state)
}

export function isOperatorAttention(state: string): boolean {
  return OPERATOR_ATTENTION_STATES.has(state)
}

export function shouldStopPolling(state: string): boolean {
  return isTerminalSuccess(state) || isOperatorAttention(state)
}
