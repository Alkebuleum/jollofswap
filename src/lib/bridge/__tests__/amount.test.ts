import { describe, it, expect } from 'vitest'
import { parseAlkeAmount, formatAlkeAmount, formatAlkeAmountCommas, validateAmount } from '../amount'
import { ALKE_BRIDGE_MIN_RAW, ALKE_BRIDGE_MAX_PER_TX_RAW } from '../config'

describe('parseAlkeAmount', () => {
  it('parses a plain decimal string to raw 18-decimal bigint', () => {
    expect(parseAlkeAmount('1300')).toBe(1300000000000000000000n)
  })

  it('returns null for empty/invalid input', () => {
    expect(parseAlkeAmount('')).toBeNull()
    expect(parseAlkeAmount('abc')).toBeNull()
    expect(parseAlkeAmount('-5')).toBeNull()
  })

  it('round-trips through formatAlkeAmount', () => {
    const raw = parseAlkeAmount('1300.5')!
    expect(formatAlkeAmount(raw)).toBe('1300.5')
  })
})

describe('formatAlkeAmountCommas', () => {
  it('adds thousands separators', () => {
    expect(formatAlkeAmountCommas(325000000000000000000000n)).toBe('325,000.0')
  })
})

describe('validateAmount', () => {
  it('rejects below minimum', () => {
    expect(validateAmount(ALKE_BRIDGE_MIN_RAW - 1n)).toBe('below_minimum')
  })

  it('accepts exactly the minimum', () => {
    expect(validateAmount(ALKE_BRIDGE_MIN_RAW)).toBeNull()
  })

  it('rejects above max-per-tx', () => {
    expect(validateAmount(ALKE_BRIDGE_MAX_PER_TX_RAW + 1n)).toBe('above_max_per_tx')
  })

  it('accepts exactly the max-per-tx', () => {
    expect(validateAmount(ALKE_BRIDGE_MAX_PER_TX_RAW)).toBeNull()
  })

  it('rejects amounts exceeding balance', () => {
    const amt = ALKE_BRIDGE_MIN_RAW
    expect(validateAmount(amt, { balanceRaw: amt - 1n })).toBe('insufficient_balance')
  })

  it('rejects when daily-limit tracking is supplied and would be exceeded', () => {
    const amt = ALKE_BRIDGE_MIN_RAW
    expect(validateAmount(amt, { alreadyMovedTodayRaw: 1300000000000000000000000n })).toBe('daily_limit_reached')
  })
})
