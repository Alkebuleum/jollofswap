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

const BURN_TO_RELEASE_MESSAGES: Record<string, string> = {
  BURN_DETECTED: 'Burn detected',
  BURN_CONFIRMING: 'Waiting for BNB Chain confirmations',
  BURN_CONFIRMED: 'ALKE burn confirmed',
  BURN_VALIDATING: 'Validating bridge request',
  RELEASE_AUTHORIZATION_PENDING: 'Preparing native ALKE release',
  RELEASE_READY: 'Release ready',
  RELEASE_SUBMITTING: 'Submitting release transaction',
  RELEASE_SUBMITTED: 'Release submitted',
  RELEASE_CONFIRMING: 'Waiting for Alkebuleum confirmations',
  RELEASE_CONFIRMED: 'Release confirmed',
  COMPLETED: 'Bridge complete',
}

export function mapBridgeStateToMessage(direction: 'lock-to-mint' | 'burn-to-release', state: string): string {
  if (isOperatorAttention(state)) {
    return 'This bridge transaction requires operator attention. Do not submit another transfer for the same funds.'
  }
  const table = direction === 'lock-to-mint' ? LOCK_TO_MINT_MESSAGES : BURN_TO_RELEASE_MESSAGES
  return table[state] ?? state
}
