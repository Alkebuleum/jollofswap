import { describe, it, expect } from 'vitest'
import { checkMahDeposit, MahDepositRefused } from '../mahPrecheck'

const A = '0x1111111111111111111111111111111111111111'
const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

describe('checkMahDeposit (before sending USDC to the vault)', () => {
  it('goes ahead while the bridge mints MAH v1', async () => {
    await expect(checkMahDeposit('https://b', A, 1n, reply(200, { ok: true, mode: 'v1', canDeposit: true }))).resolves.toEqual({ delayed: false })
  })

  it('goes ahead on an older bridge without the endpoint', async () => {
    await expect(checkMahDeposit('https://b', A, 1n, reply(404, { error: 'not found' }))).resolves.toEqual({ delayed: false })
  })

  it('goes ahead when MAH v2 can mint it, and says when it will be later', async () => {
    await expect(checkMahDeposit('https://b', A, 1n, reply(200, { ok: true, mode: 'v2', canDeposit: true, delayed: true }))).resolves.toEqual({ delayed: true })
  })

  it('stops before anything is sent when MAH v2 would refuse it', async () => {
    const cases: [string, RegExp][] = [
      ['recipient_not_registered', /Nuru Account/],
      ['frozen', /on hold/],
      ['above_deposit_limit', /at most \$1,000/],
      ['paused', /paused/],
    ]
    for (const [reason, msg] of cases) {
      const p = checkMahDeposit('https://b', A, 1n, reply(200, { ok: true, mode: 'v2', canDeposit: false, reason, maxPerDepositUsdc: '1000000000' }))
      await expect(p).rejects.toBeInstanceOf(MahDepositRefused)
      await expect(p).rejects.toThrow(msg)
    }
  })

  it('stops when the bridge can\'t be asked (fails closed)', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    await expect(checkMahDeposit('https://b', A, 1n, down)).rejects.toThrow(/Couldn’t check the bridge/)
    await expect(checkMahDeposit('https://b', A, 1n, reply(502, { ok: false, error: 'chain_unavailable' }))).rejects.toThrow(/Couldn’t check/)
  })

  it('asks with the recipient and the exact USDC amount', async () => {
    let asked = ''
    const spy = (async (url: string) => { asked = url; return new Response(JSON.stringify({ ok: true, mode: 'v1', canDeposit: true })) }) as unknown as typeof fetch
    await checkMahDeposit('https://bridge.jollofswap.com/', A, 12_345_678n, spy)
    expect(asked).toBe(`https://bridge.jollofswap.com/v1/bridge/mah-precheck?recipient=${A}&amountUsdc=12345678`)
  })
})
