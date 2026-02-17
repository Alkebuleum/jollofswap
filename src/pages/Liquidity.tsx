// src/pages/Liquidity.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { logAmmEventsFromReceipt } from '../lib/ammEventLogger'
import { collection, onSnapshot, orderBy, query, where, limit, collectionGroup } from 'firebase/firestore'
import { db } from '../services/firebase'

import { ethers } from 'ethers'
import { useAuth, sendTransactions } from 'amvault-connect'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  ALK_CHAIN_ID,
  ALK_RPC,
  ROUTER,
  TOKENS,
  TokenKey,
  enabledTokenKeys,
  clampAmountStr,
  fmtNum,
  readDecimals,
  getBalance,
  getAllowance,
  applySlippage,
  buildApproveTx,
  buildAddLiquidityTx,
  getLpPosition,
  tokenAddressForPath,
  planAddLiquidity,
  quote,
} from '../lib/jollofAmm'
import { routerIface } from '../lib/jollofAmm'
import WalletSummaryCard from '../components/WalletSummaryCard'
import { readHideBalances, readSlippageBps, writeSlippageBps, PREF } from '../lib/prefs'
import { useWalletMetaStore } from '../store/walletMetaStore'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

const FACTORY = (import.meta.env.VITE_JOLLOF_FACTORY_ALK as string) ?? ''
const MIN_POOL_RESERVE_HUMAN = '0.01' // per side, tune

const FACTORY_ABI = ['function protocolTreasury() view returns (address)']
const ERC20_XFER_IFACE = new ethers.Interface(['function transfer(address to,uint256 value) returns (bool)'])
const PAIR_SYNC_IFACE = new ethers.Interface(['function sync()'])

function buildErc20TransferTx(tokenAddr: string, to: string, amount: bigint) {
  return {
    to: tokenAddr,
    data: ERC20_XFER_IFACE.encodeFunctionData('transfer', [to, amount]),
    value: 0n,
  }
}



function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ✅ Never pass BigInt to sendTransactions (it may JSON-serialize internally)
function hexValue(v: any): string {
  if (v == null) return '0x0'
  if (typeof v === 'bigint') return ethers.toBeHex(v)
  if (typeof v === 'number') return ethers.toBeHex(BigInt(v))
  if (typeof v === 'string') return v // assume already hex/decimal
  return '0x0'
}

function normalizeTxForAmVault(tx: any) {
  const out: any = { ...tx }
  out.value = hexValue(out?.value ?? 0)

  const isRouter = (out?.to || '').toLowerCase() === (ROUTER || '').toLowerCase()

  // Defaults (match your console TX / TX8)
  const defaultGasLimit = isRouter ? 8_000_000 : 2_000_000
  const defaultGasPrice = 5_000_000_000n // 5 gwei

  // gasLimit / gas
  if (out.gasLimit == null && out.gas == null) out.gasLimit = defaultGasLimit
  if (typeof out.gasLimit === 'bigint') out.gasLimit = Number(out.gasLimit)
  if (out.gas == null) out.gas = out.gasLimit
  if (typeof out.gas === 'bigint') out.gas = Number(out.gas)

  // gasPrice
  out.gasPrice = hexValue(out.gasPrice ?? defaultGasPrice)

  // force legacy type 0 on Besu
  out.type = 0

  return out
}

async function waitForReceipt(provider: ethers.JsonRpcProvider, txHash: string, maxPolls = 80, pollMs = 1500) {
  for (let i = 0; i < maxPolls; i++) {
    const r = await provider.getTransactionReceipt(txHash)
    if (r) return r
    await sleep(pollMs)
  }
  return null
}

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const routerTxIface2 = new ethers.Interface([
  'function removeLiquidity(address tokenA,address tokenB,uint256 liquidity,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB)',
  'function removeLiquidityETH(address token,uint256 liquidity,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) returns (uint256 amountToken,uint256 amountETH)',
])

function buildLpApproveTx(pairAddr: string, spender: string, amount: bigint) {
  const i = new ethers.Interface(ERC20_ABI)
  return {
    to: pairAddr,
    data: i.encodeFunctionData('approve', [spender, amount]),
    value: 0n,
  }
}

function buildRemoveLiquidityTx(args: {
  tokenA: any
  tokenB: any
  liquidity: bigint
  amountAMin: bigint
  amountBMin: bigint
  recipient: string
  deadlineSec: number
}) {
  const { tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, deadlineSec } = args
  const deadline = Math.floor(Date.now() / 1000) + deadlineSec

  const AisNative = !!tokenA.isNative
  const BisNative = !!tokenB.isNative

  if (AisNative && BisNative) throw new Error('Invalid pair: both tokens are native.')

  // If one side is native => use removeLiquidityETH(token, liquidity, tokenMin, ethMin, to, deadline)
  if (AisNative !== BisNative) {
    const erc20Side = AisNative ? tokenB : tokenA
    const tokenAddr = tokenAddressForPath(erc20Side) // maps AKE->WAKE, others->address

    const amountTokenMin = AisNative ? amountBMin : amountAMin
    const amountETHMin = AisNative ? amountAMin : amountBMin

    return {
      to: ROUTER,
      data: routerTxIface2.encodeFunctionData('removeLiquidityETH', [
        tokenAddr,
        liquidity,
        amountTokenMin,
        amountETHMin,
        recipient,
        BigInt(deadline),
      ]),
      value: 0n,
    }
  }

  // Both ERC20 => removeLiquidity(tokenA, tokenB, liquidity, minA, minB, to, deadline)
  const addrA = tokenAddressForPath(tokenA)
  const addrB = tokenAddressForPath(tokenB)

  return {
    to: ROUTER,
    data: routerTxIface2.encodeFunctionData('removeLiquidity', [
      addrA,
      addrB,
      liquidity,
      amountAMin,
      amountBMin,
      recipient,
      BigInt(deadline),
    ]),
    value: 0n,
  }
}

type TxLine = {
  hash: string
  label: string
  status: 'pending' | 'mined_ok' | 'mined_fail' | 'unknown'
  reason?: string
}

function pickRevertData(err: any): string | null {
  const candidates = [
    err?.data,
    err?.error?.data,
    err?.info?.error?.data,
    err?.info?.error?.data?.data,
    err?.info?.error?.data?.result,
    err?.revert?.data,
    err?.error?.revert?.data,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('0x')) return c
  }
  return null
}

function tryDecodeRevert(err: any): string {
  const data = pickRevertData(err)
  if (!data) return err?.shortMessage || err?.message || 'Reverted (no data)'

  // Custom errors
  try {
    const parsed = routerIface.parseError(data)
    if (parsed) {
      const args = Array.from(parsed.args ?? []).map(String).join(', ')
      return `RouterError: ${parsed.name}(${args})`
    }
  } catch { }

  // Error(string)
  try {
    if (data.slice(0, 10) === '0x08c379a0') {
      const reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10))[0]
      return `Error: ${reason}`
    }
  } catch { }

  // Panic(uint256)
  try {
    if (data.slice(0, 10) === '0x4e487b71') {
      const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + data.slice(10))[0]
      return `Panic: ${code.toString()}`
    }
  } catch { }

  return `Reverted (data=${data.slice(0, 18)}…)`
}

async function getRevertReasonFromChain(provider: ethers.JsonRpcProvider, txHash: string): Promise<string | null> {
  const tx = await provider.getTransaction(txHash)
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!tx || !receipt) return null
  if (receipt.status === 1) return null

  try {
    await provider.call({
      to: tx.to ?? undefined,
      from: tx.from,
      data: tx.data,
      value: tx.value ?? 0n,
      blockTag: receipt.blockNumber,
    })
    return null
  } catch (e: any) {
    return tryDecodeRevert(e)
  }
}

export default function Liquidity() {
  const { session } = useAuth()
  const walletConnected = !!session
  const address = session?.address ?? null

  const { ain, ainLoading } = useWalletMetaStore()


  const provider = useMemo(() => new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID), [])

  const enabled = useMemo(() => enabledTokenKeys(), [])
  const defaultA = enabled.includes('MAH') ? ('MAH' as TokenKey) : enabled[0]
  const defaultB = enabled.includes('ALKE') ? ('ALKE' as TokenKey) : enabled[1] ?? enabled[0]

  const [tokenA, setTokenA] = useState<TokenKey>(defaultA)
  const [tokenB, setTokenB] = useState<TokenKey>(defaultB)
  const [amtA, setAmtA] = useState('100')
  const [amtB, setAmtB] = useState('1')
  const didUserEditRef = useRef(false)
  const posReqRef = useRef(0)

  const [lastEdited, setLastEdited] = useState<'A' | 'B'>('A')

  const [rawReserveA, setRawReserveA] = useState<bigint>(0n)
  const [rawReserveB, setRawReserveB] = useState<bigint>(0n)
  const [decAState, setDecAState] = useState<number>(18)
  const [decBState, setDecBState] = useState<number>(18)
  const [poolHasReserves, setPoolHasReserves] = useState(false)

  const [poolDetailsOpen, setPoolDetailsOpen] = useState(false)
  const [poolManageOpen, setPoolManageOpen] = useState(false)
  const [lpTotalSupplyUi, setLpTotalSupplyUi] = useState<string>('—')
  const [lpBalRaw, setLpBalRaw] = useState<bigint>(0n)
  const [lpSupplyRaw, setLpSupplyRaw] = useState<bigint>(0n)

  const [feesPnlUi, setFeesPnlUi] = useState<string>('—')
  const [feesPnlNote, setFeesPnlNote] = useState<string | null>(null)


  const [ratioAtoB, setRatioAtoB] = useState<string>('—')
  const [ratioBtoA, setRatioBtoA] = useState<string>('—')

  const [slippageBps, setSlippageBps] = useState<number>(() => readSlippageBps(50))
  const [hideBalances, setHideBalances] = useState<boolean>(() => readHideBalances())

  const [sp] = useSearchParams()
  const location = useLocation()
  const didInitRouteRef = useRef(false)

  const [isAdmin, setIsAdmin] = useState(false)
  const [lpGate, setLpGate] = useState<{ blocked: boolean; reason: string | null }>({
    blocked: false,
    reason: null,
  })
  const [repairA, setRepairA] = useState('') // human units
  const [repairB, setRepairB] = useState('')







  function tokenKeyFromParam(v: string | null): TokenKey | null {
    if (!v) return null
    const s = v.trim().toUpperCase()
    return (enabled as string[]).includes(s) ? (s as TokenKey) : null
  }

  useEffect(() => {
    if (didInitRouteRef.current) return
    didInitRouteRef.current = true

    const st: any = (location as any).state

    const stA = tokenKeyFromParam(st?.tokenA ?? st?.a ?? null)
    const stB = tokenKeyFromParam(st?.tokenB ?? st?.b ?? null)

    const qA = tokenKeyFromParam(sp.get('a') ?? sp.get('tokenA'))
    const qB = tokenKeyFromParam(sp.get('b') ?? sp.get('tokenB'))

    let nextA = stA || qA || defaultA
    let nextB = stB || qB || defaultB

    if (nextA === nextB) {
      nextB = ((enabled as string[]).find((x) => x !== nextA) as TokenKey) ?? nextB
    }

    setTokenA(nextA)
    setTokenB(nextB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
      ; (async () => {
        try {
          if (!address || !FACTORY || !ethers.isAddress(FACTORY)) {
            if (alive) setIsAdmin(false)
            return
          }
          const f = new ethers.Contract(FACTORY, FACTORY_ABI, provider)
          const treasury: string = await f.protocolTreasury()
          const admin = (treasury && treasury !== ethers.ZeroAddress) ? treasury : FACTORY
          if (alive) setIsAdmin(admin.toLowerCase() === address.toLowerCase())
        } catch {
          if (alive) setIsAdmin(false)
        }
      })()
    return () => { alive = false }
  }, [address, provider])



  useEffect(() => {
    writeSlippageBps(slippageBps)
  }, [slippageBps])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREF.HIDE_BALANCES) setHideBalances(readHideBalances())
      if (e.key === PREF.SLIPPAGE_BPS) setSlippageBps(readSlippageBps(50))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const [balA, setBalA] = useState('—')
  const [balB, setBalB] = useState('—')
  const [loadingBalances, setLoadingBalances] = useState(false)

  const [pairAddr, setPairAddr] = useState<string>('—')
  const [lpBalUi, setLpBalUi] = useState<string>('—')
  const [lpShareUi, setLpShareUi] = useState<string>('—')

  const [reserveAUi, setReserveAUi] = useState<string>('—')
  const [reserveBUi, setReserveBUi] = useState<string>('—')
  const [underAUi, setUnderAUi] = useState<string>('—')
  const [underBUi, setUnderBUi] = useState<string>('—')

  const [txLines, setTxLines] = useState<TxLine[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removePct, setRemovePct] = useState(100)

  const REMOVE_PREFLIGHT = {
    flow: 'remove_liquidity_v1',
    gasTopup: { enabled: true, purpose: 'jswap-remove-liquidity' },
  } as any

  const LIQ_PREFLIGHT = {
    flow: 'liquidity_v1',
    gasTopup: { enabled: true, purpose: 'jswap-liquidity' },
  } as any

  const tokenOptions = enabled

  async function refreshBalances() {
    if (!address) {
      setBalA('—')
      setBalB('—')
      return
    }
    const [b1, b2] = await Promise.all([
      getBalance(address, TOKENS[tokenA], provider),
      getBalance(address, TOKENS[tokenB], provider),
    ])
    const [d1, d2] = await Promise.all([readDecimals(TOKENS[tokenA], provider), readDecimals(TOKENS[tokenB], provider)])
    setBalA(fmtNum(ethers.formatUnits(b1, d1)))
    setBalB(fmtNum(ethers.formatUnits(b2, d2)))
  }

  function fmtLp(balance: bigint) {
    const raw = balance.toString()
    const ui = ethers.formatUnits(balance, 18) // human
    const n = Number(ui)

    // If it’s too small to be meaningful in human form, show raw units
    if (!isFinite(n) || n === 0 || Math.abs(n) < 0.000001) {
      return `${raw} (raw)`
    }
    return fmtNum(ui)
  }


  async function refreshPositionAndReserves() {
    const req = ++posReqRef.current
    const isLive = () => req === posReqRef.current

    // Clear immediately so we never show old pair data while loading
    setPairAddr('—')
    setLpBalUi('—')
    setLpShareUi('—')
    setReserveAUi('—')
    setReserveBUi('—')
    setUnderAUi('—')
    setUnderBUi('—')
    setRawReserveA(0n)
    setRawReserveB(0n)
    setPoolHasReserves(false)
    setRatioAtoB('—')
    setRatioBtoA('—')

    if (!address || tokenA === tokenB) return

    const A = TOKENS[tokenA]
    const B = TOKENS[tokenB]

    try {
      const pos = await getLpPosition({ owner: address, tokenA: A, tokenB: B })
      if (!isLive()) return

      const pair = pos.pair && pos.pair !== ethers.ZeroAddress ? pos.pair : ''
      setPairAddr(pair || '—')

      setLpBalRaw(pos.lpBalance)
      setLpSupplyRaw(pos.totalSupply)

      setLpBalUi(fmtLp(pos.lpBalance))
      setLpTotalSupplyUi(fmtLp(pos.totalSupply))

      setLpBalRaw(pos.lpBalance)
      setLpSupplyRaw(pos.totalSupply)


      if (!pair) {
        // keep cleared raw reserves/ratios/poolHasReserves so UI doesn't show defaults
        return
      }

      const pairC = new ethers.Contract(pair, PAIR_ABI, provider)
      const [t0, t1, reserves] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()])
      if (!isLive()) return

      const r0 = reserves[0] as bigint
      const r1 = reserves[1] as bigint

      const addrA = tokenAddressForPath(A).toLowerCase()
      const addrB = tokenAddressForPath(B).toLowerCase()
      const token0 = (t0 as string).toLowerCase()
      const token1 = (t1 as string).toLowerCase()

      let reserveA = 0n
      let reserveB = 0n

      if (addrA === token0 && addrB === token1) {
        reserveA = r0
        reserveB = r1
      } else if (addrA === token1 && addrB === token0) {
        reserveA = r1
        reserveB = r0
      } else {
        reserveA = r0
        reserveB = r1
      }

      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      if (!isLive()) return

      setReserveAUi(fmtNum(ethers.formatUnits(reserveA, decA)))
      setReserveBUi(fmtNum(ethers.formatUnits(reserveB, decB)))

      setRawReserveA(reserveA)
      setRawReserveB(reserveB)
      setDecAState(decA)
      setDecBState(decB)

      // Gate if pool exists but either side is below minimum threshold
      if (pair && pos.totalSupply > 0n) {
        const minA = ethers.parseUnits(MIN_POOL_RESERVE_HUMAN, decA)
        const minB = ethers.parseUnits(MIN_POOL_RESERVE_HUMAN, decB)

        const broken = reserveA < minA || reserveB < minB
        if (broken) {
          setLpGate({
            blocked: true,
            reason: `Pool is in repair mode (very low / imbalanced reserves). Adding liquidity is disabled to protect users.`,
          })
        } else {
          setLpGate({ blocked: false, reason: null })
        }
      } else {
        // no pool yet (or fresh init) => allow seeding
        setLpGate({ blocked: false, reason: null })
      }


      const has = reserveA > 0n && reserveB > 0n
      setPoolHasReserves(has)

      if (has) {
        const oneA = ethers.parseUnits('1', decA)
        const oneB = ethers.parseUnits('1', decB)
        const outB = quote(oneA, reserveA, reserveB)
        const outA = quote(oneB, reserveB, reserveA)
        setRatioAtoB(fmtNum(ethers.formatUnits(outB, decB)))
        setRatioBtoA(fmtNum(ethers.formatUnits(outA, decA)))
      } else {
        setRatioAtoB('—')
        setRatioBtoA('—')
      }

      if (pos.totalSupply > 0n && pos.lpBalance > 0n && has) {
        const underA = (reserveA * pos.lpBalance) / pos.totalSupply
        const underB = (reserveB * pos.lpBalance) / pos.totalSupply
        setUnderAUi(fmtNum(ethers.formatUnits(underA, decA)))
        setUnderBUi(fmtNum(ethers.formatUnits(underB, decB)))
      } else {
        setUnderAUi('0')
        setUnderBUi('0')
      }
    } catch {
      // keep the cleared UI
    }
  }


  useEffect(() => {
    didUserEditRef.current = false
    setLastEdited('A')
  }, [tokenA, tokenB])

  useEffect(() => {
    if (!poolHasReserves) return
    if (didUserEditRef.current) return
    if (lastEdited === 'A') syncBFromA(amtA)
    else syncAFromB(amtB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolHasReserves, rawReserveA, rawReserveB, decAState, decBState])

  useEffect(() => {
    let alive = true
      ; (async () => {
        setLoadingBalances(true)
        try {
          if (!alive) return
          await refreshBalances()
        } catch (e: any) {
          if (!alive) return
          console.warn('balance refresh failed', e?.message || e)
        } finally {
          if (!alive) return
          setLoadingBalances(false)
        }
      })()
    const id = window.setInterval(() => {
      if (!alive) return
      refreshBalances().catch(() => { })
    }, 12000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokenA, tokenB])

  useEffect(() => {
    let alive = true
      ; (async () => {
        try {
          if (!alive) return
          await refreshPositionAndReserves()
        } catch {
          if (!alive) return
        }
      })()
    const id = window.setInterval(() => {
      if (!alive) return
      refreshPositionAndReserves().catch(() => { })
    }, 12000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokenA, tokenB])


  // ---------------- Fees / P&L (from Firestore logs) ----------------
  useEffect(() => {
    if (!address || !pairAddr || pairAddr === '—') {
      setFeesPnlUi('—')
      setFeesPnlNote(null)
      return
    }

    const D = 1_000_000n
    const LP_FEE_PPM = 2_500n // 0.25%

    const bn = (x: any) => {
      try { return BigInt(x ?? 0) } catch { return 0n }
    }
    const lower = (x: any) => String(x ?? '').toLowerCase()

    const aAddr = tokenAddressForPath(TOKENS[tokenA]).toLowerCase()
    const bAddr = tokenAddressForPath(TOKENS[tokenB]).toLowerCase()
    const pairKey = `${ALK_CHAIN_ID}_${pairAddr.toLowerCase()}`
    const userKey = address.toLowerCase()

    const map01toAB = (token0: string, token1: string, v0: bigint, v1: bigint) => {
      const t0 = lower(token0)
      const t1 = lower(token1)
      const a = lower(aAddr)
      const b = lower(bAddr)
      if (a === t0 && b === t1) return { a: v0, b: v1 }
      if (a === t1 && b === t0) return { a: v1, b: v0 }
      return { a: v0, b: v1 }
    }

    // 1) user liquidity history (Mint/Burn + Sync in same tx)
    const qUser = query(
      collectionGroup(db, 'amm_events'),
      where('pairKey', '==', pairKey),
      where('user', '==', userKey),
      orderBy('blockTime', 'asc'),
      limit(1500)
    )

    const unsubUser = onSnapshot(qUser, (snap) => {
      // group by txHash so we can find Sync in same tx
      const byTx = new Map<string, any[]>()
      snap.forEach((d) => {
        const x: any = d.data()
        const tx = String(x.txHash || '')
        if (!tx) return
        const arr = byTx.get(tx) ?? []
        arr.push(x)
        byTx.set(tx, arr)
      })

      let depValueA = 0n
      let wdrValueA = 0n
      let firstAddTime: number | null = null

      for (const rows of byTx.values()) {
        const sync = rows.find((r) => r?.event === 'Sync')
        const mint = rows.find((r) => r?.event === 'Mint' && r?.action === 'add_liquidity')
        const burn = rows.find((r) => r?.event === 'Burn' && r?.action === 'remove_liquidity')

        // reserves at this tx (for valuation)
        let rA = 0n, rB = 0n
        if (sync?.args?.reserve0 != null && sync?.args?.reserve1 != null) {
          const mapped = map01toAB(sync.token0, sync.token1, bn(sync.args.reserve0), bn(sync.args.reserve1))
          rA = mapped.a
          rB = mapped.b
        }

        const bToA = (bRaw: bigint) => {
          if (rA === 0n || rB === 0n) return 0n
          return quote(bRaw, rB, rA)
        }

        if (mint?.args?.amount0 != null && mint?.args?.amount1 != null) {
          if (!firstAddTime && typeof mint.blockTime === 'number') firstAddTime = mint.blockTime
          const mapped = map01toAB(mint.token0, mint.token1, bn(mint.args.amount0), bn(mint.args.amount1))
          depValueA += mapped.a + bToA(mapped.b)
        }

        if (burn?.args?.amount0 != null && burn?.args?.amount1 != null) {
          const mapped = map01toAB(burn.token0, burn.token1, bn(burn.args.amount0), bn(burn.args.amount1))
          wdrValueA += mapped.a + bToA(mapped.b)
        }
      }

      // current position value in A (using current reserves)
      let curValueA = 0n
      if (rawReserveA > 0n && rawReserveB > 0n && lpSupplyRaw > 0n && lpBalRaw > 0n) {
        const curA = (rawReserveA * lpBalRaw) / lpSupplyRaw
        const curB = (rawReserveB * lpBalRaw) / lpSupplyRaw
        curValueA = curA + quote(curB, rawReserveB, rawReserveA)
      }

      const pnlA = (curValueA + wdrValueA) - depValueA
      const pnlUi = `${pnlA >= 0n ? '+' : ''}${fmtNum(ethers.formatUnits(pnlA, decAState))} ${tokenA}`

        ; (window as any).__jswap_firstAddTime = firstAddTime
      setFeesPnlUi(`P&L: ${pnlUi} • Fees: …`)
      setFeesPnlNote('Fees are estimated (uses current LP share). Exact fees require LP share over time.')
    })

    // 2) swaps fee estimate since first add
    const qSwaps = query(
      collectionGroup(db, 'amm_events'),
      where('pairKey', '==', pairKey),
      where('event', '==', 'Swap'),
      orderBy('blockTime', 'asc'),
      limit(2000)
    )

    const unsubSwaps = onSnapshot(qSwaps, (snap) => {
      const firstAddTime: number | null = (window as any).__jswap_firstAddTime ?? null
      if (!firstAddTime) return

      if (lpSupplyRaw <= 0n || lpBalRaw <= 0n) {
        setFeesPnlUi((prev) => prev.replace(/Fees: .*/, `Fees: 0 ${tokenA} (est)`))
        return
      }

      const sharePpm = (lpBalRaw * 1_000_000n) / lpSupplyRaw

      let totalFeeA = 0n
      let totalFeeB = 0n

      snap.forEach((d) => {
        const x: any = d.data()
        if (!x?.blockTime || x.blockTime < firstAddTime) return

        const a0In = bn(x?.args?.amount0In)
        const a1In = bn(x?.args?.amount1In)

        const fee0 = (a0In * LP_FEE_PPM) / D
        const fee1 = (a1In * LP_FEE_PPM) / D

        const mapped = map01toAB(x.token0, x.token1, fee0, fee1)
        totalFeeA += mapped.a
        totalFeeB += mapped.b
      })

      let feesValueA = 0n
      if (rawReserveA > 0n && rawReserveB > 0n) {
        feesValueA = totalFeeA + quote(totalFeeB, rawReserveB, rawReserveA)
      }

      const userFeesA = (feesValueA * sharePpm) / 1_000_000n
      const feesUi = `+${fmtNum(ethers.formatUnits(userFeesA, decAState))} ${tokenA} (est)`
      setFeesPnlUi((prev) => prev.replace(/Fees: .*/, `Fees: ${feesUi}`))
    })

    return () => {
      unsubUser()
      unsubSwaps()
    }
  }, [address, pairAddr, tokenA, tokenB, rawReserveA, rawReserveB, decAState, lpBalRaw, lpSupplyRaw])


  async function onAddLiquidity() {
    setErr(null)
    setInfo(null)
    setTxLines([])
    setBusy(true)
    try {
      if (!walletConnected || !address) throw new Error('Connect amVault using the top bar to continue.')
      if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')
      if (tokenA === tokenB) throw new Error('Select different tokens.')

      if (lpGate.blocked && !isAdmin) {
        throw new Error(lpGate.reason ?? 'Pool needs admin repair before adding liquidity.')
      }


      const aStr = clampAmountStr(amtA.trim())
      const bStr = clampAmountStr(amtB.trim())
      if (!aStr || Number(aStr) <= 0) throw new Error('Enter a valid Amount A.')
      if (!bStr || Number(bStr) <= 0) throw new Error('Enter a valid Amount B.')

      const A = TOKENS[tokenA]
      const B = TOKENS[tokenB]

      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      const amountA = ethers.parseUnits(aStr, decA)
      const amountB = ethers.parseUnits(bStr, decB)

      const plan = await planAddLiquidity({
        tokenA: A,
        tokenB: B,
        amountADesired: amountA,
        amountBDesired: amountB,
        slippageBps,
        provider,
      })

      const usedA = plan.usedA
      const usedB = plan.usedB
      const minA = plan.minA
      const minB = plan.minB

      if (usedA !== amountA || usedB !== amountB) {
        const usedAUi = fmtNum(ethers.formatUnits(usedA, decA))
        const usedBUi = fmtNum(ethers.formatUnits(usedB, decB))
        setInfo(`Pool ratio adjusted amounts: ~${usedAUi} ${tokenA} + ~${usedBUi} ${tokenB}. Confirm in amVault…`)
      }

      const txs: any[] = []

      if (!A.isNative) {
        const allowanceA = await getAllowance(address, A, ROUTER, provider)
        if (allowanceA < usedA) {
          const approveTx = buildApproveTx(A, ROUTER, usedA)
          if (approveTx) txs.push(approveTx)
        }
      }
      if (!B.isNative) {
        const allowanceB = await getAllowance(address, B, ROUTER, provider)
        if (allowanceB < usedB) {
          const approveTx = buildApproveTx(B, ROUTER, usedB)
          if (approveTx) txs.push(approveTx)
        }
      }

      const addTx = buildAddLiquidityTx({
        tokenA: A,
        tokenB: B,
        amountA,
        amountB,
        amountAMin: minA,
        amountBMin: minB,
        recipient: address,
        deadlineSec: 10 * 60,
        valueNative: plan.nativeValue > 0n ? plan.nativeValue : undefined,
      })
      txs.push(addTx)

      const safeTxs = txs.map(normalizeTxForAmVault)

      setInfo('Submitted to amVault. Confirm…')

      const results = await sendTransactions(
        {
          chainId: ALK_CHAIN_ID,
          txs: safeTxs,
          failFast: true,
          preflight: LIQ_PREFLIGHT,
        } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = results?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const hashes: string[] = (results || [])
        .map((r: any) => r?.txHash as string | undefined)
        .filter(Boolean) as string[]

      const labels: string[] = safeTxs.map((t: any, i: number) => {
        const isRouter = (t?.to || '').toLowerCase() === ROUTER.toLowerCase()
        if (isRouter) return 'addLiquidity'
        return `approve #${i + 1}`
      })

      setTxLines(
        hashes.map((h, idx) => ({
          hash: h,
          label: labels[idx] ?? `tx #${idx + 1}`,
          status: 'pending',
        }))
      )

      setInfo('Waiting for on-chain confirmation…')

      let anyFail = false
      let lastReason: string | null = null
      const nextLines: TxLine[] = []

      for (let i = 0; i < hashes.length; i++) {
        const h = hashes[i]
        const r = await waitForReceipt(provider, h)

        if (!r) {
          nextLines.push({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'unknown' })
          anyFail = true
        } else if (r.status === 1) {
          nextLines.push({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'mined_ok' })
          if (labels[i] === 'addLiquidity') {
            await logAmmEventsFromReceipt({
              provider,
              chainId: ALK_CHAIN_ID,
              receipt: r,
              action: 'add_liquidity',
              user: address,
              ain: ainLoading ? null : (ain ?? null),
              tokenA,
              tokenB,
              pairHint: pairAddr !== '—' ? pairAddr : null, // optional
            })
          }

        } else {
          anyFail = true

          let reason = await getRevertReasonFromChain(provider, h)

          if (!reason) {
            const txObj = await provider.getTransaction(h)
            if (txObj?.gasLimit && r.gasUsed >= txObj.gasLimit - 1000n) {
              reason = `Out of gas (gasUsed≈gasLimit). Increase gasLimit.`
            }
          }

          reason = reason ?? 'reverted (no reason decoded)'
          lastReason = reason

          nextLines.push({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'mined_fail', reason })
        }

        setTxLines([
          ...nextLines,
          ...hashes.slice(i + 1).map((hh, j): TxLine => ({
            hash: hh,
            label: labels[i + 1 + j] ?? `tx #${i + 2 + j}`,
            status: 'pending',
          })),
        ])
      }

      if (anyFail) {
        setErr(
          lastReason
            ? `addLiquidity reverted: ${lastReason}`
            : 'One or more transactions reverted or did not confirm. See statuses below.'
        )
        setInfo(null)
      } else {
        setInfo('Liquidity confirmed on-chain ✅')
      }

      await refreshBalances()
      await refreshPositionAndReserves()
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Add Liquidity failed.')
      setInfo(null)
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveLiquidity() {
    setErr(null)
    setInfo(null)
    setTxLines([])
    setBusy(true)

    try {
      if (!walletConnected || !address) throw new Error('Connect amVault using the top bar to continue.')
      if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')
      if (tokenA === tokenB) throw new Error('Select different tokens.')
      if (!pairAddr || pairAddr === '—') throw new Error('No pair found for this token selection.')
      if (removePct <= 0) throw new Error('Pick a remove percentage.')

      const A = TOKENS[tokenA]
      const B = TOKENS[tokenB]

      const pos = await getLpPosition({ owner: address, tokenA: A, tokenB: B })
      const pair = pos.pair && pos.pair !== ethers.ZeroAddress ? pos.pair : ''
      if (!pair) throw new Error('No pool exists yet for this pair.')
      if (pos.lpBalance <= 0n) throw new Error('You have no LP tokens for this pool.')

      const pctBps = BigInt(Math.max(0, Math.min(100, removePct)) * 100)
      const lpToRemove = (pos.lpBalance * pctBps) / 10_000n
      if (lpToRemove <= 0n) throw new Error('Remove amount too small.')

      const pairC = new ethers.Contract(pair, PAIR_ABI, provider)
      const [t0, t1, reserves] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()])
      const r0 = reserves[0] as bigint
      const r1 = reserves[1] as bigint

      const addrA = tokenAddressForPath(A).toLowerCase()
      const addrB = tokenAddressForPath(B).toLowerCase()
      const token0 = (t0 as string).toLowerCase()
      const token1 = (t1 as string).toLowerCase()

      let reserveA = 0n
      let reserveB = 0n
      if (addrA === token0 && addrB === token1) {
        reserveA = r0
        reserveB = r1
      } else if (addrA === token1 && addrB === token0) {
        reserveA = r1
        reserveB = r0
      } else {
        reserveA = r0
        reserveB = r1
      }

      if (pos.totalSupply <= 0n) throw new Error('Pool totalSupply is zero (unexpected).')
      const outA = (reserveA * lpToRemove) / pos.totalSupply
      const outB = (reserveB * lpToRemove) / pos.totalSupply

      const minA = applySlippage(outA, slippageBps)
      const minB = applySlippage(outB, slippageBps)

      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      setInfo(
        `Removing ${removePct}%: ~${fmtNum(ethers.formatUnits(outA, decA))} ${tokenA} + ~${fmtNum(
          ethers.formatUnits(outB, decB)
        )} ${tokenB}. Confirm in amVault…`
      )

      const txs: any[] = []

      const lpC = new ethers.Contract(pair, ERC20_ABI, provider)
      const lpAllowance: bigint = await lpC.allowance(address, ROUTER)
      if (lpAllowance < lpToRemove) {
        txs.push(buildLpApproveTx(pair, ROUTER, lpToRemove))
      }

      txs.push(
        buildRemoveLiquidityTx({
          tokenA: A,
          tokenB: B,
          liquidity: lpToRemove,
          amountAMin: minA,
          amountBMin: minB,
          recipient: address,
          deadlineSec: 10 * 60,
        })
      )

      const safeTxs = txs.map(normalizeTxForAmVault)

      const results = await sendTransactions(
        {
          chainId: ALK_CHAIN_ID,
          txs: safeTxs,
          failFast: true,
          preflight: REMOVE_PREFLIGHT,
        } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = results?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const hashes: string[] = (results || [])
        .map((r: any) => r?.txHash as string | undefined)
        .filter(Boolean) as string[]

      const labels = safeTxs.map((t: any) => {
        const toAddr = (t?.to || '').toLowerCase()
        if (toAddr === pair.toLowerCase()) return 'approve LP'
        if (toAddr === ROUTER.toLowerCase()) return 'removeLiquidity'
        return 'tx'
      })

      setTxLines(hashes.map((h, i) => ({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'pending' })))
      setInfo('Waiting for on-chain confirmation…')

      let anyFail = false
      let lastReason: string | null = null
      const nextLines: TxLine[] = []

      for (let i = 0; i < hashes.length; i++) {
        const h = hashes[i]
        const r = await waitForReceipt(provider, h)

        if (!r) {
          anyFail = true
          nextLines.push({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'unknown' })
        } else if (r.status === 1) {
          nextLines.push({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'mined_ok' })
          if (labels[i] === 'removeLiquidity') {
            await logAmmEventsFromReceipt({
              provider,
              chainId: ALK_CHAIN_ID,
              receipt: r,
              action: 'remove_liquidity',
              user: address,
              ain: ainLoading ? null : (ain ?? null),
              tokenA,
              tokenB,
              pairHint: pairAddr !== '—' ? pairAddr : null,
            })
          }


        } else {
          anyFail = true
          let reason = await getRevertReasonFromChain(provider, h)

          if (!reason) {
            const txObj = await provider.getTransaction(h)
            if (txObj?.gasLimit && r.gasUsed >= txObj.gasLimit - 1000n) {
              reason = `Out of gas (gasUsed≈gasLimit). Increase gasLimit.`
            }
          }

          reason = reason ?? 'reverted (no reason decoded)'
          lastReason = reason

          nextLines.push({ hash: h, label: labels[i] ?? `tx #${i + 1}`, status: 'mined_fail', reason })
        }

        setTxLines([
          ...nextLines,
          ...hashes.slice(i + 1).map((hh, j): TxLine => ({
            hash: hh,
            label: labels[i + 1 + j] ?? `tx #${i + 2 + j}`,
            status: 'pending',
          })),
        ])
      }

      if (anyFail) {
        setErr(lastReason ? `removeLiquidity reverted: ${lastReason}` : 'One or more transactions reverted or did not confirm.')
        setInfo(null)
      } else {
        setInfo('Liquidity removed ✅')
      }

      await refreshBalances()
      await refreshPositionAndReserves()
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Remove Liquidity failed.')
      setInfo(null)
    } finally {
      setBusy(false)
    }
  }

  async function onRepairPool() {
    setErr(null)
    setInfo(null)
    setTxLines([])
    setBusy(true)

    try {
      if (!walletConnected || !address) throw new Error('Connect amVault to continue.')
      if (!isAdmin) throw new Error('Admin only.')
      if (!pairAddr || pairAddr === '—') throw new Error('No pair found.')

      const A = TOKENS[tokenA]
      const B = TOKENS[tokenB]
      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])

      const aStr = clampAmountStr(repairA.trim())
      const bStr = clampAmountStr(repairB.trim())

      const donateA = aStr ? ethers.parseUnits(aStr, decA) : 0n
      const donateB = bStr ? ethers.parseUnits(bStr, decB) : 0n
      if (donateA <= 0n && donateB <= 0n) throw new Error('Enter a donate amount.')

      // donate uses ERC20 addresses (native ALKE side is WAKE via tokenAddressForPath)
      const addrA = tokenAddressForPath(A)
      const addrB = tokenAddressForPath(B)

      const txs: any[] = []
      if (donateA > 0n) txs.push(buildErc20TransferTx(addrA, pairAddr, donateA))
      if (donateB > 0n) txs.push(buildErc20TransferTx(addrB, pairAddr, donateB))

      // sync() to update reserves
      txs.push({ to: pairAddr, data: PAIR_SYNC_IFACE.encodeFunctionData('sync', []), value: 0n })

      const safeTxs = txs.map(normalizeTxForAmVault)

      setInfo('Repair queued. Confirm in amVault…')

      const results = await sendTransactions(
        { chainId: ALK_CHAIN_ID, txs: safeTxs, failFast: true, preflight: { flow: 'repair_pool_v1' } } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = results?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const hashes: string[] = (results || []).map((r: any) => r?.txHash).filter(Boolean)
      setInfo('Waiting for confirmation…')

      // wait for last tx (sync) to log Sync event
      const syncHash = hashes[hashes.length - 1]
      const receipt = await waitForReceipt(provider, syncHash)
      if (receipt && receipt.status === 1) {
        await logAmmEventsFromReceipt({
          provider,
          chainId: ALK_CHAIN_ID,
          receipt,
          action: 'admin_repair',
          user: address,
          ain: ainLoading ? null : (ain ?? null),
          tokenA,
          tokenB,
          pairHint: pairAddr,
        })
      }

      setInfo('Pool repaired ✅ (donation + sync)')
      await refreshPositionAndReserves()
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Repair failed.')
      setInfo(null)
    } finally {
      setBusy(false)
    }
  }


  function trim6(s: string) {
    if (!s.includes('.')) return s
    const [a, b] = s.split('.')
    return `${a}.${(b || '').slice(0, 6)}`
  }

  function syncBFromA(aStr: string) {
    if (!poolHasReserves || rawReserveA === 0n || rawReserveB === 0n) return
    const v = clampAmountStr(aStr)
    if (!v || Number(v) <= 0) return setAmtB('')
    try {
      const aIn = ethers.parseUnits(v, decAState)
      const bOut = quote(aIn, rawReserveA, rawReserveB)
      setAmtB(trim6(ethers.formatUnits(bOut, decBState)))
    } catch { }
  }

  function syncAFromB(bStr: string) {
    if (!poolHasReserves || rawReserveA === 0n || rawReserveB === 0n) return
    const v = clampAmountStr(bStr)
    if (!v || Number(v) <= 0) return setAmtA('')
    try {
      const bIn = ethers.parseUnits(v, decBState)
      const aOut = quote(bIn, rawReserveB, rawReserveA)
      setAmtA(trim6(ethers.formatUnits(aOut, decAState)))
    } catch { }
  }

  const balADisplay = hideBalances ? '•••' : (loadingBalances ? '…' : balA)
  const balBDisplay = hideBalances ? '•••' : (loadingBalances ? '…' : balB)

  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Liquidity</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Provide liquidity and verify it on-chain.
            </p>
          </div>
          <button
            onClick={async () => {
              setErr(null)
              setInfo('Refreshing…')
              try {
                await refreshBalances()
                await refreshPositionAndReserves()
                setInfo(null)
              } catch {
                setInfo(null)
              }
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        <WalletSummaryCard
          walletConnected={walletConnected}
          address={address}
          ain={ainLoading ? null : ain}
          stats={[
            { label: tokenA, value: balADisplay },
            { label: tokenB, value: balBDisplay },
          ]}
          notConnectedHint="Connect amVault using the top bar to add liquidity."
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          {/* Add liquidity */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Add Liquidity</div>
                {/* <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Router:{' '}
                  <span className="font-mono text-xs">{ROUTER ? shortAddr(ROUTER) : '—'}</span>
                </div> */}
              </div>
              <Badge>Network: Alkebuleum</Badge>
            </div>

            <div className="mt-4 grid gap-3">
              {/* Token A */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Token A</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Bal: {balADisplay}</div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <select
                    className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    value={tokenA}
                    onChange={(e) => setTokenA(e.target.value as TokenKey)}
                  >
                    {tokenOptions.map((k) => (
                      <option key={k} value={k} disabled={k === tokenB}>
                        {k}
                      </option>
                    ))}
                  </select>

                  <input
                    value={amtA}
                    onChange={(e) => {
                      const v = clampAmountStr(e.target.value)
                      didUserEditRef.current = true
                      setLastEdited('A')
                      setAmtA(v)
                      syncBFromA(v)
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="100"
                    inputMode="decimal"
                  />
                </div>
              </div>

              {/* Token B */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Token B</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Bal: {balBDisplay}</div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <select
                    className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    value={tokenB}
                    onChange={(e) => setTokenB(e.target.value as TokenKey)}
                  >
                    {tokenOptions.map((k) => (
                      <option key={k} value={k} disabled={k === tokenA}>
                        {k}
                      </option>
                    ))}
                  </select>

                  <input
                    value={amtB}
                    onChange={(e) => {
                      const v = clampAmountStr(e.target.value)
                      didUserEditRef.current = true
                      setLastEdited('B')
                      setAmtB(v)
                      syncAFromB(v)
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="1"
                    inputMode="decimal"
                  />
                </div>
              </div>
            </div>

            {/*      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {poolHasReserves ? (
                <>
                  Pool ratio:{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    1 {tokenA} ≈ {ratioAtoB} {tokenB}
                  </span>
                </>
              ) : (
                <>No pool ratio yet — first liquidity sets the price.</>
              )}
            </div> */}

            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Slippage</span>
              <div className="flex items-center gap-2">
                {[30, 50, 100].map((bps) => (
                  <button
                    key={bps}
                    className={[
                      'rounded-full px-2.5 py-1 font-semibold',
                      slippageBps === bps
                        ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
                    ].join(' ')}
                    onClick={() => setSlippageBps(bps)}
                  >
                    {(bps / 100).toFixed(2)}%
                  </button>
                ))}
              </div>
            </div>

            {err && (
              <div className="mt-3 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                {err}
              </div>
            )}
            {info && (
              <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                {info}
              </div>
            )}

            {/* {txLines.length > 0 && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-2 font-semibold text-slate-800 dark:text-slate-100">
                  Transaction confirmation
                </div>
                <div className="grid gap-2">
                  {txLines.map((t) => (
                    <div
                      key={t.hash}
                      className="rounded-lg border border-slate-100 p-2 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {t.label}
                          </span>
                          <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                            {shortAddr(t.hash)}
                          </span>
                        </div>

                        <span
                          className={[
                            'text-xs font-semibold',
                            t.status === 'pending' ? 'text-slate-600 dark:text-slate-300' : '',
                            t.status === 'mined_ok' ? 'text-emerald-700 dark:text-emerald-300' : '',
                            t.status === 'mined_fail' ? 'text-red-700 dark:text-red-300' : '',
                            t.status === 'unknown' ? 'text-amber-700 dark:text-amber-300' : '',
                          ].join(' ')}
                        >
                          {t.status === 'pending' && 'pending'}
                          {t.status === 'mined_ok' && 'confirmed ✅'}
                          {t.status === 'mined_fail' && 'reverted ❌'}
                          {t.status === 'unknown' && 'not confirmed ⚠️'}
                        </span>
                      </div>

                      {t.status === 'mined_fail' && t.reason && (
                        <div className="mt-1 whitespace-pre-wrap text-xs text-red-700 dark:text-red-300">
                          {t.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )} */}

            <button
              onClick={onAddLiquidity}
              disabled={!walletConnected || !address || busy || (lpGate.blocked && !isAdmin)}
              className="mt-4 w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Confirming on-chain…' : 'Preview & Add'}
            </button>
          </div>

          {/* Position + pool state */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Pool</div>
                {/*    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Pair:{' '}
                  <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                    {pairAddr === '—' ? '—' : shortAddr(pairAddr)}
                  </span>
                </div> */}
              </div>

              <div className="flex items-center gap-2">
                <Badge>Fee: 0.30%</Badge>
              </div>
            </div>

            {/* Essentials (always visible) */}
            <div className="mt-4 grid gap-2">
              {/* Price */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Price</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {poolHasReserves ? (
                    <>
                      1 {tokenA} ≈ {ratioAtoB} {tokenB}
                    </>
                  ) : (
                    <>—</>
                  )}
                </div>
              </div>

              {/* Reserves */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Reserves</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {reserveAUi} {tokenA} / {reserveBUi} {tokenB}
                </div>
              </div>

              {/* Your position (investor view) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Your position</div>
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{lpShareUi}</div>
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                  {underAUi} {tokenA}
                  <span className="mx-2 text-slate-400 dark:text-slate-600">/</span>
                  {underBUi} {tokenB}
                </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  This is your share of the pool reserves right now.
                </div>
              </div>
            </div>

            {/* See details toggle */}
            <button
              type="button"
              onClick={() => setPoolDetailsOpen((v) => !v)}
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {poolDetailsOpen ? 'Hide details' : 'See details'}
            </button>

            {poolDetailsOpen && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-2">
                  <Row label="Pair address" value={pairAddr === '—' ? '—' : pairAddr} mono />
                  <Row label="LP balance" value={lpBalUi} />
                  <Row label="LP total supply" value={lpTotalSupplyUi} />
                  <Row label={`1 ${tokenB} ≈`} value={poolHasReserves ? `${ratioBtoA} ${tokenA}` : '—'} />
                  <Row label="Fees / P&L" value={feesPnlUi} />
                  {feesPnlNote && (
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{feesPnlNote}</div>
                  )}

                </div>
              </div>
            )}

            {/* Manage (remove) toggle */}
            <button
              type="button"
              onClick={() => setPoolManageOpen((v) => !v)}
              className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {poolManageOpen ? 'Hide manage' : 'Manage liquidity'}
            </button>

            {poolManageOpen && (
              <div className="mt-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-base font-bold text-slate-900 dark:text-slate-100">Remove</div>
                  <div className="text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                    {removePct}%
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      onClick={() => setRemovePct(p)}
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-semibold transition',
                        removePct === p
                          ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
                      ].join(' ')}
                    >
                      {p}%
                    </button>
                  ))}
                </div>

                <button
                  onClick={onRemoveLiquidity}
                  disabled={!walletConnected || !address || busy || pairAddr === '—'}
                  className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  {busy ? 'Confirming…' : 'Remove liquidity'}
                </button>
                {lpGate.blocked && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <div className="font-semibold">Pool in repair mode</div>
                    <div className="mt-1">{lpGate.reason}</div>
                  </div>
                )}

                {isAdmin && pairAddr !== '—' && lpGate.blocked && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Admin repair (Donate + Sync)</div>
                    <div className="mt-2 grid gap-2">
                      <input
                        value={repairA}
                        onChange={(e) => setRepairA(clampAmountStr(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                        placeholder={`Donate ${tokenA}`}
                        inputMode="decimal"
                      />
                      <input
                        value={repairB}
                        onChange={(e) => setRepairB(clampAmountStr(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
                        placeholder={`Donate ${tokenB}`}
                        inputMode="decimal"
                      />
                      <button
                        onClick={onRepairPool}
                        disabled={busy}
                        className="w-full rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
                      >
                        Repair pool
                      </button>
                    </div>
                  </div>
                )}

              </div>

            )}
          </div>

        </div>
      </div>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      {children}
    </span>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-600 dark:text-slate-400">{label}</span>

      <span
        className={[
          'min-w-0 text-right text-slate-900 dark:text-slate-100',
          mono ? 'font-mono text-xs' : 'font-semibold',
          // key fix:
          'break-all',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

