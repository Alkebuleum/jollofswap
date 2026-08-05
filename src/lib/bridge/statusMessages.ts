// src/lib/bridge/statusMessages.ts
//
// Maps backend bridge_transactions.state values to user-facing messages
// (ALKEBRIDGE.md §11). Operator-attention states get a single shared message
// instructing the user not to resubmit, plus the source hash for support.

import { isOperatorAttention } from './api'

const LOCK_TO_MINT_MESSAGES: Record<string, string> = {
  LOCK_DETECTED: 'Lock detected',
  LOCK_CONFIRMING: 'Waiting for Alkebuleum confirmations',
  LOCK_CONFIRMED: 'ALKE lock confirmed',
  LOCK_VALIDATING: 'Validating bridge request',
  MINT_AUTHORIZATION_PENDING: 'Preparing BNB Chain mint',
  MINT_READY: 'Mint ready',
  MINT_SUBMITTING: 'Submitting mint transaction',
  MINT_SUBMITTED: 'Mint submitted',
  MINT_CONFIRMING: 'Waiting for BNB Chain confirmations',
  MINT_CONFIRMED: 'Mint confirmed',
  COMPLETED: 'Bridge complete',
}

// BNB → Alkebuleum copy per the burn-registration frontend spec: states are
// grouped into fewer, plainer-language messages than the lock-to-mint table.
const BURN_TO_RELEASE_MESSAGES: Record<string, string> = {
  BURN_DETECTED: 'Waiting for BNB confirmations',
  BURN_CONFIRMING: 'Waiting for BNB confirmations',
  BURN_CONFIRMED: 'Validating bridge request',
  BURN_VALIDATING: 'Validating bridge request',
  RELEASE_AUTHORIZATION_PENDING: 'Preparing ALKE release',
  RELEASE_READY: 'Preparing ALKE release',
  RELEASE_SUBMITTING: 'Submitting ALKE release',
  RELEASE_SUBMITTED: 'Submitting ALKE release',
  RELEASE_CONFIRMING: 'Waiting for Alkebuleum confirmations',
  RELEASE_CONFIRMED: 'Waiting for Alkebuleum confirmations',
  COMPLETED: 'Bridge completed',
  // Not terminal — shouldStopPolling() keeps polling and the burn is never
  // resubmitted; this just tells the user the retry is automatic.
  FAILED_RETRYABLE: 'Temporary network issue. Your transaction is safe and will retry automatically.',
}

export function mapBridgeStateToMessage(direction: 'lock-to-mint' | 'burn-to-release', state: string): string {
  if (isOperatorAttention(state)) {
    return 'This bridge transaction requires operator attention. Do not submit another transfer for the same funds.'
  }
  const table = direction === 'lock-to-mint' ? LOCK_TO_MINT_MESSAGES : BURN_TO_RELEASE_MESSAGES
  return table[state] ?? state
}
