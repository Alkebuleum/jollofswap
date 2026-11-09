// src/lib/mahV2Migration.ts
// Old MAH v1 pool positions → MAH v2 pools, through MAHPoolMigrator
// (jollofswap-contracts: contracts/alkebuleum/MAHPoolMigrator.sol).
//
// Only one setting: VITE_MAH_POOL_MIGRATOR_ALK. Everything else (the old
// pools, MAH v2, the new router and factory) is read from the migrator. Empty
// setting → nothing shows. The card also stays hidden until the migrator is
// live: approved as the old factory's router and holding its MAH v2 reserve.
import { ethers } from 'ethers'
import { WAKE, applySlippage } from './jollofAmm'

export const POOL_MIGRATOR = ((import.meta.env.VITE_MAH_POOL_MIGRATOR_ALK as string) ?? '').trim()

export function migrationConfigured(): boolean {
  return !!POOL_MIGRATOR && ethers.isAddress(POOL_MIGRATOR)
}

const MIGRATOR_ABI = [
  'function poolList() view returns (address[])',
  'function positionOf(address oldPair, address holder) view returns (uint256 liquidity, address otherToken, uint256 otherOut, uint256 mahV2Out)',
  'function oldFactory() view returns (address)',
  'function newRouter() view returns (address)',
  'function mahV2() view returns (address)',
  'function reserve() view returns (uint256)',
  'function update(address oldPair, uint256 liquidity, uint256 otherMin, uint256 mahMin, uint256 deadline) returns (uint256 newLiquidity, uint256 refundOther, uint256 refundMah)',
  'function withdraw(address oldPair, uint256 liquidity, uint256 deadline) returns (uint256 otherOut, uint256 mahPaid)',
]
const FACTORY_ABI = [
  'function getPair(address,address) view returns (address)',
  'function isRouter(address) view returns (bool)',
]
const ROUTER_ABI = ['function factory() view returns (address)']
const PAIR_ABI = [
  'function token0() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
]
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
]

export const migratorIface = new ethers.Interface(MIGRATOR_ABI)
const erc20Iface = new ethers.Interface(ERC20_ABI)

const MAH_DECIMALS = 6
const GAS_PRICE_WEI = 5_000_000_000n
const DEADLINE_SEC = 20 * 60

export type Holder = { address: string; kind: 'account' | 'key' }

export type OldPosition = {
  pool: string
  holder: Holder
  liquidity: bigint
  otherToken: string
  otherSymbol: string
  otherDecimals: number
  otherOut: bigint
  mahOut: bigint
  /** MAH v2 has frozen this holder: nothing can move until support lifts it. */
  frozen: boolean
}

export type UpdatePlan = {
  usedOther: bigint
  usedMah: bigint
  refundOther: bigint
  refundMah: bigint
  otherMin: bigint
  mahMin: bigint
  newPoolExists: boolean
}

function migrator(provider: ethers.Provider) {
  return new ethers.Contract(POOL_MIGRATOR, MIGRATOR_ABI, provider)
}

const symbolCache = new Map<string, { symbol: string; decimals: number }>()
async function tokenMeta(provider: ethers.Provider, token: string) {
  const key = token.toLowerCase()
  const hit = symbolCache.get(key)
  if (hit) return hit
  const c = new ethers.Contract(token, ERC20_ABI, provider)
  const [symbol, decimals] = await Promise.all([
    c.symbol().catch(() => token.slice(0, 6)),
    c.decimals().then(Number).catch(() => 18),
  ])
  // WAKE is how ALKE sits in a pool; people know it as ALKE.
  const meta = { symbol: WAKE && key === WAKE.toLowerCase() ? 'ALKE' : String(symbol), decimals }
  symbolCache.set(key, meta)
  return meta
}

/** True once the migrator can pay: approved on the old factory and holding its reserve. */
export async function migrationLive(provider: ethers.Provider): Promise<boolean> {
  if (!migrationConfigured()) return false
  try {
    const m = migrator(provider)
    const [oldFactory, reserve] = await Promise.all([m.oldFactory(), m.reserve()])
    if ((reserve as bigint) <= 0n) return false
    return await new ethers.Contract(oldFactory, FACTORY_ABI, provider).isRouter(POOL_MIGRATOR)
  } catch {
    return false
  }
}

/** Every old MAH v1 pool position held by any of [holders]. */
export async function findOldPositions(provider: ethers.Provider, holders: Holder[]): Promise<OldPosition[]> {
  if (!holders.length || !(await migrationLive(provider))) return []
  const m = migrator(provider)
  const [pools, mahV2] = (await Promise.all([m.poolList(), m.mahV2()])) as [string[], string]
  const v2 = new ethers.Contract(mahV2, ['function frozen(address) view returns (bool)'], provider)
  const frozenOf = new Map<string, boolean>()
  for (const h of holders) frozenOf.set(h.address.toLowerCase(), await v2.frozen(h.address).catch(() => false))
  const out: OldPosition[] = []
  for (const pool of pools) {
    for (const holder of holders) {
      const [liquidity, otherToken, otherOut, mahOut] = await m.positionOf(pool, holder.address)
      if ((liquidity as bigint) <= 0n || (mahOut as bigint) <= 0n) continue
      const meta = await tokenMeta(provider, otherToken)
      out.push({
        pool,
        holder,
        liquidity,
        otherToken,
        otherSymbol: meta.symbol,
        otherDecimals: meta.decimals,
        otherOut,
        mahOut,
        frozen: !!frozenOf.get(holder.address.toLowerCase()),
      })
    }
  }
  return out
}

/**
 * What the new pool will take, the same way the router decides: at its current
 * price, all of one token and as much of the other as fits (the rest comes back).
 * An empty new pool takes everything at the old pool's price.
 */
export async function planUpdate(provider: ethers.Provider, pos: OldPosition, slippageBps: number): Promise<UpdatePlan> {
  const m = migrator(provider)
  const [routerAddr, mahV2] = await Promise.all([m.newRouter(), m.mahV2()])
  const factory = await new ethers.Contract(routerAddr, ROUTER_ABI, provider).factory()
  const pair: string = await new ethers.Contract(factory, FACTORY_ABI, provider).getPair(pos.otherToken, mahV2)

  let usedOther = pos.otherOut
  let usedMah = pos.mahOut
  let newPoolExists = false
  if (pair && pair !== ethers.ZeroAddress) {
    const p = new ethers.Contract(pair, PAIR_ABI, provider)
    const [t0, [r0, r1]] = await Promise.all([p.token0(), p.getReserves()])
    const otherIs0 = (t0 as string).toLowerCase() === pos.otherToken.toLowerCase()
    const rOther = (otherIs0 ? r0 : r1) as bigint
    const rMah = (otherIs0 ? r1 : r0) as bigint
    if (rOther > 0n && rMah > 0n) {
      newPoolExists = true
      const mahOptimal = (pos.otherOut * rMah) / rOther
      if (mahOptimal <= pos.mahOut) {
        usedMah = mahOptimal
      } else {
        usedOther = (pos.mahOut * rOther) / rMah
      }
    }
  }
  return {
    usedOther,
    usedMah,
    refundOther: pos.otherOut - usedOther,
    refundMah: pos.mahOut - usedMah,
    otherMin: applySlippage(usedOther, slippageBps),
    mahMin: applySlippage(usedMah, slippageBps),
    newPoolExists,
  }
}

function legacy(tx: { to: string; data: string }, gasLimit: number) {
  return {
    to: tx.to,
    data: tx.data,
    value: '0x0',
    gas: gasLimit,
    gasLimit,
    gasPrice: ethers.toBeHex(GAS_PRICE_WEI),
    type: 0,
  }
}

async function approveIfNeeded(provider: ethers.Provider, pos: OldPosition) {
  const lp = new ethers.Contract(pos.pool, ERC20_ABI, provider)
  const allowance: bigint = await lp.allowance(pos.holder.address, POOL_MIGRATOR)
  if (allowance >= pos.liquidity) return []
  return [legacy({ to: pos.pool, data: erc20Iface.encodeFunctionData('approve', [POOL_MIGRATOR, pos.liquidity]) }, 2_000_000)]
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC)

/** Approve (if needed) + update. The first move into a new pool also creates it, hence the gas. */
export async function buildUpdateTxs(provider: ethers.Provider, pos: OldPosition, plan: UpdatePlan) {
  return [
    ...(await approveIfNeeded(provider, pos)),
    legacy({ to: POOL_MIGRATOR, data: migratorIface.encodeFunctionData('update', [pos.pool, pos.liquidity, plan.otherMin, plan.mahMin, deadline()]) }, 8_000_000),
  ]
}

/** Approve (if needed) + withdraw to the holder's wallet. */
export async function buildWithdrawTxs(provider: ethers.Provider, pos: OldPosition) {
  return [
    ...(await approveIfNeeded(provider, pos)),
    legacy({ to: POOL_MIGRATOR, data: migratorIface.encodeFunctionData('withdraw', [pos.pool, pos.liquidity, deadline()]) }, 3_000_000),
  ]
}

export function fmtAmount(raw: bigint, decimals: number, maxFrac = 4): string {
  const s = ethers.formatUnits(raw, decimals)
  const [i, f = ''] = s.split('.')
  const int = Number(i).toLocaleString('en-US')
  const frac = f.slice(0, maxFrac).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

export const fmtMah = (raw: bigint) => fmtAmount(raw, MAH_DECIMALS, 2)
