import { describe, it, expect } from 'vitest'
import { ainToBytes32, bytes32ToAin, canonicalAin } from '../ain'

// Real on-chain values from the MAH P2P escrow (order #3's makerAIN).
const VI_HEX = '0x5649303532323731353200000000000000000000000000000000000000000000'

describe('canonicalAin', () => {
  it('upper-cases letters and zero-pads digits to 8', () => {
    expect(canonicalAin('vi5227152')).toBe('VI05227152')
    expect(canonicalAin(' AA00000113 ')).toBe('AA00000113')
  })
  it('rejects non-AIN input', () => {
    expect(canonicalAin('0x1234')).toBeNull()
    expect(canonicalAin('')).toBeNull()
    expect(canonicalAin(null)).toBeNull()
  })
})

describe('ainToBytes32 / bytes32ToAin', () => {
  it('matches the bytes32 the escrow stores', () => {
    expect(ainToBytes32('VI05227152')).toBe(VI_HEX)
  })
  it('round-trips', () => {
    expect(bytes32ToAin(ainToBytes32('AA00000113'))).toBe('AA00000113')
    expect(bytes32ToAin(VI_HEX)).toBe('VI05227152')
  })
  it('returns null for an empty bytes32 (no taker yet)', () => {
    expect(bytes32ToAin('0x' + '0'.repeat(64))).toBeNull()
  })
  it('throws on a non-AIN', () => {
    expect(() => ainToBytes32('nope')).toThrow()
  })
})
