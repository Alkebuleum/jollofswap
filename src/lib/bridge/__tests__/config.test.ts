import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ADDR = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4' // checksummed

describe('isAllowedBridgeWallet', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns false for null/undefined/empty/malformed with an empty allowlist', async () => {
    vi.stubEnv('VITE_ALKE_BRIDGE_ALLOWED_WALLETS', '')
    const { isAllowedBridgeWallet } = await import('../config')
    expect(isAllowedBridgeWallet(null)).toBe(false)
    expect(isAllowedBridgeWallet(undefined)).toBe(false)
    expect(isAllowedBridgeWallet('')).toBe(false)
    expect(isAllowedBridgeWallet('not-an-address')).toBe(false)
  })

  it('matches a listed wallet regardless of input casing (checksum normalization)', async () => {
    vi.stubEnv('VITE_ALKE_BRIDGE_ALLOWED_WALLETS', ADDR)
    const { isAllowedBridgeWallet } = await import('../config')
    expect(isAllowedBridgeWallet(ADDR)).toBe(true)
    expect(isAllowedBridgeWallet(ADDR.toLowerCase())).toBe(true)
    expect(isAllowedBridgeWallet(ADDR.toUpperCase().replace('0X', '0x'))).toBe(true)
  })

  it('rejects a wallet not on the list', async () => {
    vi.stubEnv('VITE_ALKE_BRIDGE_ALLOWED_WALLETS', ADDR)
    const { isAllowedBridgeWallet } = await import('../config')
    expect(isAllowedBridgeWallet('0x000000000000000000000000000000000000dEaD')).toBe(false)
  })

  it('parses a comma-separated multi-address list, ignoring whitespace and invalid entries', async () => {
    const other = '0x000000000000000000000000000000000000dEaD'
    vi.stubEnv('VITE_ALKE_BRIDGE_ALLOWED_WALLETS', ` ${ADDR} , not-valid , ${other} `)
    const { isAllowedBridgeWallet } = await import('../config')
    expect(isAllowedBridgeWallet(ADDR)).toBe(true)
    expect(isAllowedBridgeWallet(other)).toBe(true)
  })
})

describe('isAllowedBridgeAin', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns false for null/undefined/empty with an empty allowlist', async () => {
    vi.stubEnv('VITE_ALKE_BRIDGE_ALLOWED_WALLETS', '')
    const { isAllowedBridgeAin } = await import('../config')
    expect(isAllowedBridgeAin(null)).toBe(false)
    expect(isAllowedBridgeAin(undefined)).toBe(false)
    expect(isAllowedBridgeAin('')).toBe(false)
  })

  it('matches a non-address entry from the allowlist as an AIN, case-insensitively', async () => {
    vi.stubEnv('VITE_ALKE_BRIDGE_ALLOWED_WALLETS', ` ${ADDR} , foundation-01 `)
    const { isAllowedBridgeAin, isAllowedBridgeWallet } = await import('../config')
    expect(isAllowedBridgeAin('foundation-01')).toBe(true)
    expect(isAllowedBridgeAin('FOUNDATION-01')).toBe(true)
    expect(isAllowedBridgeAin(' Foundation-01 ')).toBe(true)
    expect(isAllowedBridgeAin('foundation-02')).toBe(false)
    // the address entry stays an address, not an AIN
    expect(isAllowedBridgeAin(ADDR)).toBe(false)
    expect(isAllowedBridgeWallet(ADDR)).toBe(true)
  })
})
