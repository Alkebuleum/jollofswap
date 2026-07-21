import { describe, it, expect, beforeEach } from 'vitest'
import { readActiveBridgeTx, writeActiveBridgeTx, clearActiveBridgeTx } from '../persistence'

describe('bridge tx persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns null when nothing is stored', () => {
    expect(readActiveBridgeTx()).toBeNull()
  })

  it('restores exactly what was written', () => {
    const tx = {
      direction: 'lock-to-mint' as const,
      sourceTransactionHash: '0x' + '11'.repeat(32),
      amountRaw: '1300000000000000000000',
      destinationAddress: '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4',
      submittedAt: 1234567890,
    }
    writeActiveBridgeTx(tx)
    expect(readActiveBridgeTx()).toEqual(tx)
  })

  it('clears the stored record', () => {
    writeActiveBridgeTx({
      direction: 'burn-to-release',
      sourceTransactionHash: '0x' + '22'.repeat(32),
      amountRaw: '1300000000000000000000',
      destinationAddress: '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4',
      submittedAt: Date.now(),
    })
    clearActiveBridgeTx()
    expect(readActiveBridgeTx()).toBeNull()
  })

  it('gracefully handles corrupted JSON', () => {
    localStorage.setItem('jswap:bridge:active_tx', 'not-json{{')
    expect(readActiveBridgeTx()).toBeNull()
  })
})
