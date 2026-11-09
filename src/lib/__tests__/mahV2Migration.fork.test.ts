// Runs only against a rehearsal fork (jollofswap-contracts: scripts/mah-v2/rehearse.cjs
// leaves a live pool migrator on it):
//   MAHV2_FORK_RPC=http://127.0.0.1:8551 MAHV2_MIGRATOR=0x… npx vitest run src/lib/__tests__/mahV2Migration.fork.test.ts
// Uses the card's own functions to find real holders' positions and build the
// transactions, then sends them as the holder (what their wallet would do).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { ethers } from 'ethers'

const RPC = process.env.MAHV2_FORK_RPC
const MIGRATOR = process.env.MAHV2_MIGRATOR
const run = RPC && MIGRATOR ? describe : describe.skip

const POOL_ALKE = '0x1D4405c79dDc0F3E8ca70Ad5c2788B4bdb5c6500'
const POOL_TRB = '0xcF2E0da212e9DEF5e5E951d0b7c6a837dC01c836'
// The rehearsal moves the biggest holders and freezes AA00000113 (its last step).
const AA113 = '0xF71e124677e3C5F07667c7219793B9c78F5EF871' // Main Account, in the ALKE, 7TRB and APX pools; frozen
const XM = '0xd49eA90e0365788e0626982C58e47690cAd81207' // wallet XM40646186, ALKE pool
const OU = '0xe8D1a9Ae8AD9B5cb691d749cC25C9c1DC463Bf22' // wallet OU98662374, ALKE pool
const SE = '0xf27ae17Cb10B91740e82BA70ece03f7320491C7a' // Main Account SE90623949, ALKE pool
const NOBODY = '0x000000000000000000000000000000000000bEEF'

run('MAH v2 Update position (on a rehearsal fork)', () => {
  let m: typeof import('../mahV2Migration')
  let provider: ethers.JsonRpcProvider

  async function sendAs(addr: string, txs: any[]) {
    await provider.send('hardhat_impersonateAccount', [addr])
    await provider.send('hardhat_setBalance', [addr, '0x' + (10n ** 20n).toString(16)])
    const s = new ethers.JsonRpcSigner(provider, addr)
    for (const tx of txs) {
      const r = await (await s.sendTransaction({ to: tx.to, data: tx.data, gasLimit: tx.gasLimit, gasPrice: BigInt(tx.gasPrice), type: 0 })).wait()
      expect(r?.status).toBe(1)
    }
  }

  beforeAll(async () => {
    vi.stubEnv('VITE_MAH_POOL_MIGRATOR_ALK', MIGRATOR!)
    m = await import('../mahV2Migration')
    provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true })
  })

  it('is live on the fork', async () => {
    expect(m.migrationConfigured()).toBe(true)
    expect(await m.migrationLive(provider)).toBe(true)
  })

  it('finds nothing for someone with no old position', async () => {
    expect(await m.findOldPositions(provider, [{ address: NOBODY, kind: 'account' }])).toEqual([])
  })

  it('finds AA00000113 in each pool it is in, ALKE shown as ALKE, and flags it frozen', async () => {
    const found = await m.findOldPositions(provider, [{ address: AA113, kind: 'account' }])
    const pools = found.map((p) => p.pool.toLowerCase())
    expect(pools).toContain(POOL_ALKE.toLowerCase())
    expect(pools).toContain(POOL_TRB.toLowerCase())
    expect(found.find((p) => p.pool.toLowerCase() === POOL_ALKE.toLowerCase())!.otherSymbol).toBe('ALKE')
    expect(found.every((p) => p.frozen)).toBe(true) // the card shows "on hold" instead of the buttons
  })

  it('finds both positions when the Nuru Account and the key are asked together', async () => {
    const found = await m.findOldPositions(provider, [{ address: XM, kind: 'account' }, { address: OU, kind: 'key' }])
    expect(found.map((p) => p.holder.kind).sort()).toEqual(['account', 'key'])
    expect(found.every((p) => !p.frozen)).toBe(true)
  })

  it('Update position: approve + update move the whole position into the new pool', async () => {
    const [pos] = await m.findOldPositions(provider, [{ address: XM, kind: 'account' }])
    const plan = await m.planUpdate(provider, pos, 50)
    expect(plan.newPoolExists).toBe(true) // the rehearsal opened it
    const txs = await m.buildUpdateTxs(provider, pos, plan)
    expect(txs.length).toBe(2) // approve, then update
    const mig = new ethers.Contract(MIGRATOR!, ['function newRouter() view returns (address)', 'function mahV2() view returns (address)'], provider)
    const router = new ethers.Contract(await mig.newRouter(), ['function factory() view returns (address)'], provider)
    const factory = new ethers.Contract(await router.factory(), ['function getPair(address,address) view returns (address)'], provider)
    const newPair = new ethers.Contract(await factory.getPair(pos.otherToken, await mig.mahV2()), ['function balanceOf(address) view returns (uint256)'], provider)
    const before = await newPair.balanceOf(XM)

    await sendAs(XM, txs)

    expect(await m.findOldPositions(provider, [{ address: XM, kind: 'account' }])).toEqual([])
    expect(await newPair.balanceOf(XM)).toBeGreaterThan(before)
  })

  it('Withdraw instead: the other token and MAH v2 arrive in the wallet', async () => {
    const [pos] = await m.findOldPositions(provider, [{ address: SE, kind: 'account' }])
    expect(pos).toBeTruthy()
    const mig = new ethers.Contract(MIGRATOR!, ['function mahV2() view returns (address)'], provider)
    const v2 = new ethers.Contract(await mig.mahV2(), ['function balanceOf(address) view returns (uint256)'], provider)
    const other = new ethers.Contract(pos.otherToken, ['function balanceOf(address) view returns (uint256)'], provider)
    const [v2Before, otherBefore] = await Promise.all([v2.balanceOf(SE), other.balanceOf(SE)])

    await sendAs(SE, await m.buildWithdrawTxs(provider, pos))

    expect((await v2.balanceOf(SE)) - v2Before).toBe(pos.mahOut)
    expect((await other.balanceOf(SE)) - otherBefore).toBeGreaterThanOrEqual(pos.otherOut)
    expect(await m.findOldPositions(provider, [{ address: SE, kind: 'account' }])).toEqual([])
  })

  it('a second try needs no approve (the allowance is already set)', async () => {
    const [pos] = await m.findOldPositions(provider, [{ address: OU, kind: 'account' }])
    // approve once by hand, as an earlier attempt that stopped half-way would have
    await sendAs(OU, [{ to: pos.pool, data: new ethers.Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [MIGRATOR, pos.liquidity]), gasLimit: 2_000_000, gasPrice: '0x12a05f200' }])
    const txs = await m.buildUpdateTxs(provider, pos, await m.planUpdate(provider, pos, 50))
    expect(txs.length).toBe(1)
    await sendAs(OU, txs)
    expect(await m.findOldPositions(provider, [{ address: OU, kind: 'account' }])).toEqual([])
  })

  it("a frozen holder can't move: the update is refused and the position stays", async () => {
    const [pos] = (await m.findOldPositions(provider, [{ address: AA113, kind: 'account' }])).filter((p) => p.pool.toLowerCase() === POOL_ALKE.toLowerCase())
    await expect(sendAs(AA113, await m.buildUpdateTxs(provider, pos, await m.planUpdate(provider, pos, 50)))).rejects.toThrow()
    const still = await m.findOldPositions(provider, [{ address: AA113, kind: 'account' }])
    expect(still.some((p) => p.pool.toLowerCase() === POOL_ALKE.toLowerCase())).toBe(true)
  })
})
