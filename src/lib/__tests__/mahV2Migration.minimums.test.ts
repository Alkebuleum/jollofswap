// The minimums "Update position" sends with MAHPoolMigrator.update (audit F1).
import { describe, expect, it } from 'vitest'
import { planMinimums } from '../mahV2Migration'

const e18 = (n: number) => BigInt(n) * 10n ** 18n
const e6 = (n: number) => BigInt(n) * 10n ** 6n
// A position: 1,000,000 ALKE + 80,000 MAH.
const pos = { otherOut: e18(1_000_000), mahOut: e6(80_000) }

describe('planMinimums', () => {
  it('an empty new pool (takes everything): minimums = amounts less slippage', () => {
    const m = planMinimums(pos, { usedOther: pos.otherOut, usedMah: pos.mahOut }, 50, 300)
    expect(m.otherMin).toBe((pos.otherOut * 9_950n) / 10_000n)
    expect(m.mahMin).toBe((pos.mahOut * 9_950n) / 10_000n)
    expect(m.tooFar).toBe(false)
    expect(m.priceMoveBps).toBe(0)
  })

  it('a pool a little off (1%): fine, the 1% comes back', () => {
    const used = { usedOther: (pos.otherOut * 99n) / 100n, usedMah: pos.mahOut }
    const m = planMinimums(pos, used, 50, 300)
    expect(m.tooFar).toBe(false)
    expect(m.priceMoveBps).toBe(100)
    expect(m.otherMin).toBe((used.usedOther * 9_950n) / 10_000n)
  })

  it('F1: a skewed new pool that would take 99% of the ALKE for dust is refused', () => {
    // What planUpdate predicts for a pool opened at a silly price: 1% of the ALKE fits.
    const used = { usedOther: pos.otherOut / 100n, usedMah: pos.mahOut }
    const m = planMinimums(pos, used, 50, 300)
    expect(m.tooFar).toBe(true)
    expect(m.priceMoveBps).toBe(9_900)
    // Even if it were sent, the minimums hold the position's own amounts less the 3% guard,
    // not the skewed prediction: the router would revert rather than take the ALKE.
    expect(m.otherMin).toBe((pos.otherOut * 9_700n) / 10_000n)
    expect(m.otherMin > used.usedOther).toBe(true)
  })

  it('a large slippage setting never lowers the minimums below the guard', () => {
    const m = planMinimums(pos, { usedOther: pos.otherOut, usedMah: pos.mahOut }, 4_000, 300)
    expect(m.otherMin).toBe((pos.otherOut * 9_700n) / 10_000n)
    expect(m.mahMin).toBe((pos.mahOut * 9_700n) / 10_000n)
  })

  it('the MAH side too', () => {
    const m = planMinimums(pos, { usedOther: pos.otherOut, usedMah: (pos.mahOut * 96n) / 100n }, 50, 300)
    expect(m.tooFar).toBe(true)
    expect(m.mahMin).toBe((pos.mahOut * 9_700n) / 10_000n)
  })
})
