import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  isTerminalSuccess,
  isOperatorAttention,
  shouldStopPolling,
  registerAlkeBurn,
  isNonRetryableRegistrationError,
  BridgeRegistrationError,
} from '../api'

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

describe('registerAlkeBurn', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const hash = '0x' + '33'.repeat(32)

  it('sends only the source transaction hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ registered: true, inserted: true, transaction: { id: 't1' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerAlkeBurn(hash)

    expect(fetchMock).toHaveBeenCalledWith(
      `https://bridge.jollofswap.com/v1/alke-bridge/register`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceTransactionHash: hash }),
      })
    )
    expect(result.inserted).toBe(true)
  })

  it('treats inserted:false (200) as success, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ registered: true, inserted: false, transaction: { id: 't1' } }),
      })
    )

    const result = await registerAlkeBurn(hash)
    expect(result.registered).toBe(true)
    expect(result.inserted).toBe(false)
  })

  it('throws a BridgeRegistrationError carrying the backend error code and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: 'burn_event_not_found', message: 'No matching burn event.' }),
      })
    )

    await expect(registerAlkeBurn(hash)).rejects.toMatchObject({
      message: 'No matching burn event.',
      code: 'burn_event_not_found',
      status: 422,
    })
    await expect(registerAlkeBurn(hash)).rejects.toBeInstanceOf(BridgeRegistrationError)
  })
})

describe('isNonRetryableRegistrationError', () => {
  it('flags backend validation errors as permanent', () => {
    for (const code of [
      'invalid_transaction_hash',
      'transaction_reverted',
      'wrong_destination_contract',
      'burn_event_not_found',
      'unexpected_burn_event_count',
      'burner_mismatch',
      'invalid_burn_amount',
      'wrong_rpc_chain',
    ]) {
      expect(isNonRetryableRegistrationError(code)).toBe(true)
    }
  })

  it('treats unknown/transient codes as retryable', () => {
    expect(isNonRetryableRegistrationError('internal_error')).toBe(false)
    expect(isNonRetryableRegistrationError(undefined)).toBe(false)
    expect(isNonRetryableRegistrationError(null)).toBe(false)
  })
})
