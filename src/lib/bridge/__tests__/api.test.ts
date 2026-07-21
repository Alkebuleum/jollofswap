import { describe, it, expect } from 'vitest'
import { isTerminalSuccess, isOperatorAttention, shouldStopPolling } from '../api'

describe('polling state classification', () => {
  it('treats COMPLETED as terminal success', () => {
    expect(isTerminalSuccess('COMPLETED')).toBe(true)
    expect(shouldStopPolling('COMPLETED')).toBe(true)
  })

  it('treats operator-attention states as stop-polling but not success', () => {
    for (const state of [
      'FAILED_PERMANENT',
      'MANUAL_REVIEW',
      'RECONCILIATION_REQUIRED',
      'PAUSED_BACKING_MISMATCH',
      'PAUSED_CAPACITY_EXCEEDED',
      'PAUSED_INSUFFICIENT_LOCKED_BACKING',
    ]) {
      expect(isOperatorAttention(state)).toBe(true)
      expect(isTerminalSuccess(state)).toBe(false)
      expect(shouldStopPolling(state)).toBe(true)
    }
  })

  it('keeps polling through retryable/waiting states', () => {
    for (const state of [
      'FAILED_RETRYABLE',
      'PAUSED',
      'LOCK_CONFIRMING',
      'MINT_CONFIRMING',
      'BURN_CONFIRMING',
      'RELEASE_CONFIRMING',
    ]) {
      expect(shouldStopPolling(state)).toBe(false)
    }
  })
})
