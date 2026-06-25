import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import { useSignerSession } from '../hooks/useSignerSession'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowDownUp, Info, X, CircleDollarSign } from 'lucide-react'
import { logAmmEventsFromReceipt } from '../lib/ammEventLogger'
import { db } from '../services/firebase'
import { ensureFirebaseGuest } from '../services/firebaseGuest'
import { collection, onSnapshot, orderBy, query, where, limit, getDocs } from 'firebase/firestore'
import ModernPriceChart from '../components/ModernPriceChart'


import {
  ALK_CHAIN_ID,
  ALK_RPC,
  ROUTER,
  TOKENS,
  clampAmountStr,
  fmtNum,
  readDecimals,
  getBalance,
  getAllowance,
  getQuoteOut,
  applySlippage,
  buildApproveTx,
  buildSwapTx,
  routerIface,
} from '../lib/jollofAmm'
import { useTokenRegistry } from '../lib/tokenRegistry'
import { PREF, readHideBalances, readSlippageBps, writeSlippageBps } from '../lib/prefs'


import { useWalletMetaStore } from '../store/walletMetaStore'
import { useWcStore } from '../store/wcStore'
import { useConnectModalStore } from '../store/connectModalStore'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

const FACTORY = (import.meta.env.VITE_JOLLOF_FACTORY_ALK as string) ?? ''
const WAKE = (import.meta.env.VITE_WAKE_ALK as string) ?? ''

// USD context — VITE_USD_STABLE is your on-chain stablecoin symbol (default "MAH").
// VITE_USD_STABLE_PRICE is its USD value. For JollofSwap: 1 USD = 100 MAH → price = 0.01.
const STABLE_SYM = ((import.meta.env.VITE_USD_STABLE as string) ?? 'MAH').toUpperCase()
const STABLE_USD_PRICE = Number(import.meta.env.VITE_USD_STABLE_PRICE ?? 0.01)

// Bridge / smart-route constants
const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137)
const POLY_RPC = (import.meta.env.VITE_POLY_RPC as string) ?? 'https://polygon-bor-rpc.publicnode.com'
const USDC_POLY = (import.meta.env.VITE_USDC_POLY as string) ?? '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const BRIDGEVAULT_POLY = (import.meta.env.VITE_BRIDGEVAULT_POLY as string) ?? '0x2b53bd82a7ad6a7ce8bf9a9d201cde639b8ae5e0'
const MAH_TOKEN_ALK = (import.meta.env.VITE_MAH_ALK as string) ?? '0x9983Cf46eeC1A7e75639eA1142410086b874dbf6'
const BRIDGE_API = (import.meta.env.VITE_BRIDGE_API as string) ?? 'https://bridge.jollofswap.com'
const MAH_PER_USDC = Number(import.meta.env.VITE_MAH_PER_USDC ?? 100)
const BRIDGE_FEE_BPS = Number(import.meta.env.VITE_BRIDGE_FEE_BPS ?? 10)
const BRIDGE_FEE_MIN_USD = Number(import.meta.env.VITE_BRIDGE_FEE_MIN_USD ?? 0.10)
const BRIDGE_FEE_MAX_USD = Number(import.meta.env.VITE_BRIDGE_FEE_MAX_USD ?? 2.0)

function fmtRate(r: number): string {
  if (!isFinite(r) || r <= 0) return '—'
  if (r >= 1000) return r.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (r >= 1) return r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (r >= 0.0001) return r.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  return r.toExponential(4)
}

function fmtUsd(v: number): string {
  if (!isFinite(v) || v < 0) return '—'
  if (v >= 1) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (v >= 0.0001) return v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  return v.toExponential(3)
}

const PAIR_META_IFACE = new ethers.Interface([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])


const FACTORY_IFACE = new ethers.Interface([
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
])

const PAIR_IFACE = new ethers.Interface([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
])

const MIN_SWAP_RESERVE_HUMAN = '0.001' // per side (token units). tune later.

// Bridge ABIs (for auto-bridge in onSwap)
const ERC20_WRITE_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
])
const BRIDGEVAULT_IFACE = new ethers.Interface([
  'function deposit(uint256 amount, address alkRecipient) returns (bytes32)',
])

const BRIDGE_PREFLIGHT = {
  flow: 'bridge_usdc_to_mah',
  gasTopup: {
    enabled: true,
    purpose: 'jswap-bridge',
    minBalanceWei: '300000000000000000',
    targetBalanceWei: '500000000000000000',
  },
} as any

type PairState = {
  pair: string
  token0: string
  token1: string
  reserve0: bigint
  reserve1: bigint
}

async function fetchPairState(provider: ethers.JsonRpcProvider, A: any, B: any): Promise<PairState | null> {
  if (!FACTORY || !ethers.isAddress(FACTORY)) return null
  if (!WAKE || !ethers.isAddress(WAKE)) return null

  const aAddr = pairTokenAddress(A)
  const bAddr = pairTokenAddress(B)
  if (!aAddr || !bAddr || !ethers.isAddress(aAddr) || !ethers.isAddress(bAddr)) return null

  const pairData = await provider.call({
    to: FACTORY,
    data: FACTORY_IFACE.encodeFunctionData('getPair', [aAddr, bAddr]),
  })
  const [pair] = FACTORY_IFACE.decodeFunctionResult('getPair', pairData) as any
  if (!pair || pair === ethers.ZeroAddress) return null

  const [t0Raw, t1Raw, resRaw] = await Promise.all([
    provider.call({ to: pair, data: PAIR_META_IFACE.encodeFunctionData('token0', []) }),
    provider.call({ to: pair, data: PAIR_META_IFACE.encodeFunctionData('token1', []) }),
    provider.call({ to: pair, data: PAIR_IFACE.encodeFunctionData('getReserves', []) }),
  ])

  const [token0] = PAIR_META_IFACE.decodeFunctionResult('token0', t0Raw) as any
  const [token1] = PAIR_META_IFACE.decodeFunctionResult('token1', t1Raw) as any
  const [r0, r1] = PAIR_IFACE.decodeFunctionResult('getReserves', resRaw) as any

  return {
    pair: String(pair),
    token0: String(token0),
    token1: String(token1),
    reserve0: BigInt(r0),
    reserve1: BigInt(r1),
  }
}

function reservesForFromTo(state: PairState, fromAddr: string, toAddr: string) {
  const t0 = state.token0.toLowerCase()
  const t1 = state.token1.toLowerCase()
  const f = fromAddr.toLowerCase()
  const t = toAddr.toLowerCase()

  // map reserves into "from" + "to"
  if (f === t0 && t === t1) return { reserveFrom: state.reserve0, reserveTo: state.reserve1 }
  if (f === t1 && t === t0) return { reserveFrom: state.reserve1, reserveTo: state.reserve0 }
  return { reserveFrom: 0n, reserveTo: 0n }
}

async function liquidityGuard(provider: ethers.JsonRpcProvider, A: any, B: any, symA: string, symB: string) {
  const state = await fetchPairState(provider, A, B)
  if (!state) {
    return { blocked: true, reason: `No liquidity pool for ${symA}/${symB} yet. Add liquidity first.` }
  }

  const fromAddr = pairTokenAddress(A)
  const toAddr = pairTokenAddress(B)
  if (!fromAddr || !toAddr) return { blocked: true, reason: 'Invalid token addresses.' }

  const fromDec = await readDecimals(A, provider)
  const toDec = await readDecimals(B, provider)

  const { reserveFrom, reserveTo } = reservesForFromTo(state, fromAddr, toAddr)

  const minFrom = ethers.parseUnits(MIN_SWAP_RESERVE_HUMAN, fromDec)
  const minTo = ethers.parseUnits(MIN_SWAP_RESERVE_HUMAN, toDec)

  if (reserveFrom < minFrom || reserveTo < minTo) {
    return {
      blocked: true,
      reason: `Liquidity too low (dust pool). Add liquidity before swapping ${symA}/${symB}.`,
    }
  }

  return { blocked: false as const, reason: '' }
}


function pairTokenAddress(t: any) {
  // router uses WAKE for native; mirror that here
  if (t?.isNative) return WAKE
  return t?.address
}

async function detectNoLiquidity(provider: ethers.JsonRpcProvider, A: any, B: any) {
  try {
    if (!FACTORY || !ethers.isAddress(FACTORY)) return false
    const a = pairTokenAddress(A)
    const b = pairTokenAddress(B)
    if (!a || !b || !ethers.isAddress(a) || !ethers.isAddress(b)) return false
    if (!WAKE || !ethers.isAddress(WAKE)) return false // needed for native pairs

    const pairData = await provider.call({
      to: FACTORY,
      data: FACTORY_IFACE.encodeFunctionData('getPair', [a, b]),
    })
    const [pair] = FACTORY_IFACE.decodeFunctionResult('getPair', pairData) as any
    if (!pair || pair === ethers.ZeroAddress) return true // pair not created

    const resData = await provider.call({
      to: pair,
      data: PAIR_IFACE.encodeFunctionData('getReserves', []),
    })
    const [r0, r1] = PAIR_IFACE.decodeFunctionResult('getReserves', resData) as any
    return (BigInt(r0) === 0n || BigInt(r1) === 0n) // no reserves
  } catch {
    return false
  }
}



type PricePoint = { t: number; p: number }


function hexValue(v: any): string {
  if (v == null) return '0x0'
  if (typeof v === 'bigint') return ethers.toBeHex(v)
  if (typeof v === 'number') return ethers.toBeHex(BigInt(v))
  if (typeof v === 'string') return v
  return '0x0'
}

function normalizeTx(tx: any) {
  const out: any = { ...tx }
  out.value = hexValue(out?.value ?? 0)

  const isRouter = (out?.to || '').toLowerCase() === (ROUTER || '').toLowerCase()
  const defaultGasLimit = isRouter ? 8_000_000 : 2_000_000
  const defaultGasPrice = 5_000_000_000n // 5 gwei
  if (out.gasLimit == null && out.gas == null) out.gasLimit = defaultGasLimit
  if (typeof out.gasLimit === 'bigint') out.gasLimit = Number(out.gasLimit)
  if (out.gas == null) out.gas = out.gasLimit
  if (typeof out.gas === 'bigint') out.gas = Number(out.gas)
  out.gasPrice = hexValue(out.gasPrice ?? defaultGasPrice)
  out.type = 0
  return out
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForReceipt(provider: ethers.JsonRpcProvider, txHash: string, maxPolls = 80, pollMs = 1500) {
  for (let i = 0; i < maxPolls; i++) {
    const r = await provider.getTransactionReceipt(txHash)
    if (r) return r
    await sleep(pollMs)
  }
  return null
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

  try {
    const parsed = routerIface.parseError(data)
    if (parsed) {
      const args = Array.from(parsed.args ?? []).map(String).join(', ')
      return `RouterError: ${parsed.name}(${args})`
    }
  } catch { }

  try {
    if (data.slice(0, 10) === '0x08c379a0') {
      const reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10))[0]
      return `Error: ${reason}`
    }
  } catch { }

  try {
    if (data.slice(0, 10) === '0x4e487b71') {
      const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + data.slice(10))[0]
      return `Panic: ${code.toString()}`
    }
  } catch { }

  return `Reverted (data=${data.slice(0, 18)}…)`
}

async function getRevertReasonFromChain(
  provider: ethers.JsonRpcProvider,
  txHash: string
): Promise<string | null> {
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

export default function Swap() {
  const { isConnected: walletConnected, address } = useWalletConnection()

  const { ain, ainLoading, aaWallet } = useWalletMetaStore()
  // signer = EOA (signs txs, holds Polygon assets); address = aaWallet (holds Alkebuleum assets)
  // polyAddress = EOA signer for Polygon queries; falls back to address for AmVault users
  const polyAddress = (useWcStore((s) => s.signer) ?? address) as string
  const { startFlow, endFlow, sessionSendTransactions, sessionSignMessage } = useSignerSession()
  const { openModal } = useConnectModalStore()

  const provider = useMemo(() => new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID), [])
  const polyProvider = useMemo(() => new ethers.JsonRpcProvider(POLY_RPC, POLY_CHAIN_ID), [])
  const [sp] = useSearchParams()
  const location = useLocation()
  const didInitRef = useRef(false)
  // Tracks signer's MAH on Alkebuleum separately — used for auto-deposit before swaps
  const signerMahRef = useRef<{ raw: bigint; dec: number } | null>(null)

  type TokenSym = string

  const { tokens: regTokens } = useTokenRegistry()

  const tokenOptions = useMemo(() => {
    const set = new Set<string>()
    for (const t of regTokens || []) {
      const sym = (t.symbol ?? '').trim().toUpperCase()
      if (sym) set.add(sym)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [regTokens])

  const bySymbol = useMemo(() => {
    const m: Record<string, any> = {}
    for (const t of regTokens || []) {
      m[t.symbol] = {
        address: t.address,
        isNative: !!t.isNative || (t.address || '').toLowerCase() === ethers.ZeroAddress,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
      }
    }
    return m
  }, [regTokens])

  const byAddress = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of regTokens || []) {
      if (t.address) m[t.address.toLowerCase()] = t.symbol
    }
    return m
  }, [regTokens])

  function getToken(sym: TokenSym) {
    return bySymbol[sym] ?? (TOKENS as any)[sym] ?? null
  }

  const [from, setFrom] = useState<TokenSym>('USDC')
  const [to, setTo] = useState<TokenSym>('ALKE')

  // true when "from" is the virtual USD/USDC entry (not an on-chain Alkebuleum token)
  const isUsdcMode = from === 'USDC'

  const [amount, setAmount] = useState('100')

  // Combined USD balance (USDC on Polygon + MAH on Alkebuleum in USD terms)
  const [usdcBalNum, setUsdcBalNum] = useState<number>(0)
  const [mahForUsdNum, setMahForUsdNum] = useState<number>(0)   // aaWallet MAH on Alkebuleum
  const [signerMahNum, setSignerMahNum] = useState<number>(0)   // signer EOA MAH on Alkebuleum
  const [totalUsdNum, setTotalUsdNum] = useState<number>(0)
  const [loadingUsdBal, setLoadingUsdBal] = useState(false)
  const [usdBalInfoOpen, setUsdBalInfoOpen] = useState(false)

  const [fromBal, setFromBal] = useState('—')
  const [fromBalNum, setFromBalNum] = useState<number>(0)
  const [toBal, setToBal] = useState('—')
  const [polBal, setPolBal] = useState('—')
  const [loadingBalances, setLoadingBalances] = useState(false)

  const [slippageBps, setSlippageBps] = useState<number>(() => readSlippageBps(50))
  const [hideBalances, setHideBalances] = useState<boolean>(() => readHideBalances())

  const [quoteOut, setQuoteOut] = useState<string>('—')
  const [minOut, setMinOut] = useState<string>('—')

  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [depositLoading, setDepositLoading] = useState(false)
  const [depositErr, setDepositErr] = useState<string | null>(null)

  // Swap progress dialog (phases include auto-bridge stages)
  const [swapDialogOpen, setSwapDialogOpen] = useState(false)
  const [swapDialogPhase, setSwapDialogPhase] = useState<'waiting' | 'consolidating' | 'bridging' | 'minting' | 'confirming' | 'success' | 'error'>('waiting')
  const [swapDialogErr, setSwapDialogErr] = useState<string | null>(null)
  const [swapDialogDetails, setSwapDialogDetails] = useState<{
    fromSym: string
    toSym: string
    amountIn: string
    estimatedOut: string
    txHash: string
  } | null>(null)
  const [preSwapBals, setPreSwapBals] = useState<{ from: string; to: string } | null>(null)

  const quoteTimer = useRef<number | null>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

  const [quoteNotice, setQuoteNotice] = useState<string | null>(null)
  const [quoteNoLiquidity, setQuoteNoLiquidity] = useState(false)

  function isNoLiquidityLike(msg: string) {
    const s = (msg || '').toLowerCase()
    return (
      s.includes('insufficient_liquidity') ||
      s.includes('insufficient liquidity') ||
      s.includes('insufficient_output_amount') ||
      s.includes('insufficient output amount') ||
      s.includes('insufficient_input_amount') ||
      s.includes('insufficient input amount') ||
      s.includes('no liquidity') ||
      s.includes('pair') && s.includes('not') // “pair not found” style messages
    )
  }


  const SWAP_PREFLIGHT = {
    flow: 'swap_v1',
    gasTopup: { enabled: true, purpose: 'jswap-swap' },
  } as any

  const [priceData, setPriceData] = useState<PricePoint[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [tokenModalFor, setTokenModalFor] = useState<'from' | 'to' | null>(null)
  const [tokenSearch, setTokenSearch] = useState('')


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


  useEffect(() => {
    let unsub: (() => void) | null = null

      ; (async () => {
        try {
          if (from === to) return setPriceData([])

          // In USDC mode the on-chain swap is MAH → to, so use MAH for the chart
          const A = getToken(from === 'USDC' ? 'MAH' : from)
          const B = getToken(to)
          if (!A || !B) return setPriceData([])

          if (!FACTORY || !ethers.isAddress(FACTORY)) return setPriceData([])

          const aAddr = pairTokenAddress(A)
          const bAddr = pairTokenAddress(B)
          if (!aAddr || !bAddr || !ethers.isAddress(aAddr) || !ethers.isAddress(bAddr)) return setPriceData([])

          // pair
          const pairData = await provider.call({
            to: FACTORY,
            data: FACTORY_IFACE.encodeFunctionData('getPair', [aAddr, bAddr]),
          })
          const [pair] = FACTORY_IFACE.decodeFunctionResult('getPair', pairData) as any
          if (!pair || pair === ethers.ZeroAddress) return setPriceData([])

          // token0/token1
          const [t0Data, t1Data] = await Promise.all([
            provider.call({ to: pair, data: PAIR_META_IFACE.encodeFunctionData('token0', []) }),
            provider.call({ to: pair, data: PAIR_META_IFACE.encodeFunctionData('token1', []) }),
          ])
          const [token0] = PAIR_META_IFACE.decodeFunctionResult('token0', t0Data) as any
          const [token1] = PAIR_META_IFACE.decodeFunctionResult('token1', t1Data) as any

          const fromAddr = String(aAddr).toLowerCase()
          const toAddr = String(bAddr).toLowerCase()
          const t0 = String(token0).toLowerCase()
          const t1 = String(token1).toLowerCase()

          const fromDec = await readDecimals(A as any, provider)
          const toDec = await readDecimals(B as any, provider)

          function priceFromReserves(res0: bigint, res1: bigint): number | null {
            if (res0 === 0n || res1 === 0n) return null

            // res0=reserves of token0, res1=reserves of token1
            // want: (to per 1 from)

            if (fromAddr === t0 && toAddr === t1) {
              const rFrom = Number(ethers.formatUnits(res0, fromDec))
              const rTo = Number(ethers.formatUnits(res1, toDec))
              if (!Number.isFinite(rFrom) || !Number.isFinite(rTo) || rFrom <= 0) return null
              return rTo / rFrom
            }

            if (fromAddr === t1 && toAddr === t0) {
              const rTo = Number(ethers.formatUnits(res0, toDec))
              const rFrom = Number(ethers.formatUnits(res1, fromDec))
              if (!Number.isFinite(rFrom) || !Number.isFinite(rTo) || rFrom <= 0) return null
              return rTo / rFrom
            }

            return null
          }

          const pairKey = `${ALK_CHAIN_ID}_${String(pair).toLowerCase()}`

          // Ensure Firebase auth so Firestore security rules allow reads
          try { await ensureFirebaseGuest() } catch (e) { console.warn('[PriceChart] Firebase guest auth failed:', e) }

          // Find the most recent Sync for this pair to anchor the time window
          const latestSnap = await getDocs(query(
            collection(db, 'amm_events'),
            where('pairKey', '==', pairKey),
            where('event', '==', 'Sync'),
            orderBy('blockTime', 'desc'),
            limit(1)
          ))

          if (latestSnap.empty) return setPriceData([])

          const latestBlockTime = latestSnap.docs[0].data().blockTime as number
          const minBlockTime = latestBlockTime - 365 * 24 * 60 * 60 // 1 year before the latest record

          const qy = query(
            collection(db, 'amm_events'),
            where('pairKey', '==', pairKey),
            where('event', '==', 'Sync'),
            where('blockTime', '>=', minBlockTime),
            orderBy('blockTime', 'asc'),
            limit(2000)
          )

          unsub = onSnapshot(qy, (snap) => {
            const pts: PricePoint[] = []
            snap.forEach((doc) => {
              const x: any = doc.data()
              const r0s = x?.args?.reserve0
              const r1s = x?.args?.reserve1
              const tMs =
                typeof x?.blockTimeMs === 'number'
                  ? x.blockTimeMs
                  : typeof x?.blockTime === 'number'
                    ? x.blockTime * 1000
                    : null

              if (!r0s || !r1s || !tMs) return

              const p = priceFromReserves(BigInt(r0s), BigInt(r1s))
              if (p == null) return
              pts.push({ t: tMs, p })
            })

            setPriceData(pts)
          }, (err) => {
            console.error('[PriceChart] Firestore snapshot error:', err)
          })
        } catch (e) {
          console.error('[PriceChart] setup error:', e)
          setPriceData([])
        }
      })()

    return () => {
      if (unsub) unsub()
    }
  }, [provider, from, to, tokenOptions.length])




  function tokenKeyFromParam(v: string | null): TokenSym | null {
    if (!v) return null
    const s = v.trim()
    if (!s) return null

    if (s.toUpperCase() === 'USDC') return 'USDC'

    const sym = tokenOptions.find((k) => k.toLowerCase() === s.toLowerCase())
    if (sym) return sym

    if (/^0x[a-fA-F0-9]{40}$/.test(s)) {
      const found = byAddress[s.toLowerCase()]
      return found ?? null
    }
    return null
  }

  useEffect(() => {
    if (didInitRef.current) return
    if (tokenOptions.length === 0) return

    didInitRef.current = true

    const st: any = (location as any).state
    const stFrom = tokenKeyFromParam(st?.from ?? null)
    const stTo = tokenKeyFromParam(st?.to ?? null)

    const qFrom = tokenKeyFromParam(sp.get('from'))
    const qTo = tokenKeyFromParam(sp.get('to'))

    const fallbackFrom = 'USDC' // default: unified USD swap mode
    const fallbackTo =
      tokenOptions.includes('ALKE')
        ? 'ALKE'
        : tokenOptions.find((x) => x !== 'MAH') ?? tokenOptions[0] ?? 'ALKE'

    const nextFrom = stFrom || qFrom || fallbackFrom
    let nextTo = stTo || qTo || fallbackTo

    if (nextTo === nextFrom) {
      nextTo = tokenOptions.find((x) => x !== nextFrom) ?? nextTo
    }

    setFrom(nextFrom)
    setTo(nextTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenOptions.length])

  useEffect(() => {
    let alive = true
    let isFirst = true

    async function load() {
      // Only show spinner on the first fetch — background polls update silently
      if (isFirst) setLoadingBalances(true)
      try {
        if (!address) {
          if (!alive) return
          setFromBal('—')
          setFromBalNum(0)
          setToBal('—')
          return
        }
        // Alkebuleum balances: sum AA wallet + signer for each token (mirrors Nuru wallet).
        // In browser mode signer funds can't be moved (aaWallet.execute wraps all txs),
        // so only show aaWallet balance — prevents showing funds the user can't actually swap.
        const alkAddress = aaWallet ?? address
        const isBrowserModeLoad = typeof window !== 'undefined' && (window as any).ethereum?._isNuruWallet === true
        const signerAlk = !isBrowserModeLoad && polyAddress && polyAddress.toLowerCase() !== alkAddress.toLowerCase()
          ? polyAddress : null
        const getCombined = async (token: ReturnType<typeof getToken>) => {
          if (!token) return 0n
          const aa = await getBalance(alkAddress, token, provider).catch(() => 0n)
          if (!signerAlk) return aa
          const sig = await getBalance(signerAlk, token, provider).catch(() => 0n)
          return aa + sig
        }

        // In USDC mode "from" is virtual — only load the "to" token balance here
        if (from === 'USDC') {
          const B = getToken(to)
          if (!B) { setToBal('—'); return }
          const b2 = await getCombined(B)
          const d2 = await readDecimals(B, provider)
          if (!alive) return
          setToBal(fmtNum(ethers.formatUnits(b2, d2)))
          return
        }

        const A = getToken(from)
        const B = getToken(to)

        if (!A || !B) {
          setFromBal('—')
          setToBal('—')
          return
        }

        const [b1, b2] = await Promise.all([getCombined(A), getCombined(B)])

        const d1 = await readDecimals(A, provider)
        const d2 = await readDecimals(B, provider)

        if (!alive) return
        const fromRaw = ethers.formatUnits(b1, d1)
        setFromBal(fmtNum(fromRaw))
        setFromBalNum(Number(fromRaw))
        setToBal(fmtNum(ethers.formatUnits(b2, d2)))
      } catch (e: any) {
        if (!alive) return
        console.warn('balance refresh failed', e?.message || e)
      } finally {
        if (!alive) return
        if (isFirst) { setLoadingBalances(false); isFirst = false }
      }
    }

    load()
    const id = window.setInterval(load, 12000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [address, from, to, provider])

  // Always-on USD balance: USDC (Polygon) + MAH (Alkebuleum) → combined USD value
  useEffect(() => {
    let alive = true
    let isFirst = true

    async function loadUsd() {
      if (!address) {
        setUsdcBalNum(0)
        setMahForUsdNum(0)
        setTotalUsdNum(0)
        setPolBal('—')
        return
      }
      // Only show spinner on the first fetch — background polls update silently
      if (isFirst) setLoadingUsdBal(true)
      try {
        // USDC on Polygon — belongs to the EOA signer, not the aaWallet
        const usdcNum = await (async () => {
          try {
            const dec: number = Number(await polyProvider.call({
              to: USDC_POLY,
              data: ERC20_WRITE_IFACE.encodeFunctionData('decimals', []),
            }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('decimals', d)[0]))
            const raw: bigint = BigInt(await polyProvider.call({
              to: USDC_POLY,
              data: ERC20_WRITE_IFACE.encodeFunctionData('balanceOf', [polyAddress]),
            }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('balanceOf', d)[0]))
            return Number(ethers.formatUnits(raw, dec))
          } catch { return 0 }
        })()

        // MAH on Alkebuleum — fetch aaWallet and signer separately, sum for display.
        // In Nuru browser mode all Alkebuleum txs are wrapped through aaWallet.execute(),
        // so signer EOA funds can't be moved; only count aaWallet balance.
        const alkAddress = aaWallet ?? address
        const isBrowserMode = typeof window !== 'undefined' && (window as any).ethereum?._isNuruWallet === true
        const signerAlkAddr = !isBrowserMode && polyAddress && polyAddress.toLowerCase() !== alkAddress.toLowerCase()
          ? polyAddress : null
        let aaMahNum = 0
        let signerMahComputed = 0
        try {
          const dec: number = Number(await provider.call({
            to: MAH_TOKEN_ALK,
            data: ERC20_WRITE_IFACE.encodeFunctionData('decimals', []),
          }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('decimals', d)[0]))
          const aaRaw: bigint = BigInt(await provider.call({
            to: MAH_TOKEN_ALK,
            data: ERC20_WRITE_IFACE.encodeFunctionData('balanceOf', [alkAddress]),
          }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('balanceOf', d)[0]))
          aaMahNum = Number(ethers.formatUnits(aaRaw, dec))
          if (signerAlkAddr) {
            const signerRaw = await provider.call({
              to: MAH_TOKEN_ALK,
              data: ERC20_WRITE_IFACE.encodeFunctionData('balanceOf', [signerAlkAddr]),
            }).then(d => BigInt(ERC20_WRITE_IFACE.decodeFunctionResult('balanceOf', d)[0])).catch(() => 0n)
            signerMahComputed = Number(ethers.formatUnits(signerRaw, dec))
            signerMahRef.current = signerRaw > 0n ? { raw: signerRaw, dec } : null
          } else {
            signerMahRef.current = null
          }
        } catch { /* leave both at 0 */ }

        const polRaw = await polyProvider.getBalance(polyAddress).catch(() => 0n)
        const polFmt = Number(ethers.formatEther(polRaw))

        if (!alive) return
        setUsdcBalNum(usdcNum)
        setMahForUsdNum(aaMahNum)                            // aaWallet only — used for swap math
        setSignerMahNum(signerMahComputed)                   // signer only — added to display + QR-path swaps
        setTotalUsdNum(usdcNum + (aaMahNum + signerMahComputed) / MAH_PER_USDC)
        setPolBal(polFmt.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 }))
      } catch (e) {
        console.warn('[USD bal]', e)
      } finally {
        if (!alive) return
        if (isFirst) { setLoadingUsdBal(false); isFirst = false }
      }
    }
    loadUsd()
    const id = window.setInterval(loadUsd, 15000)
    return () => { alive = false; window.clearInterval(id) }
  }, [address, polyAddress, polyProvider, provider])

  useEffect(() => {
    if (quoteTimer.current) window.clearTimeout(quoteTimer.current)

    quoteTimer.current = window.setTimeout(async () => {
      if (from === to) {
        setQuoteOut('—')
        setMinOut('—')
        return
      }

      const amtStr = clampAmountStr(amount.trim())
      if (!amtStr || Number(amtStr) <= 0) {
        setQuoteOut('—')
        setMinOut('—')
        return
      }

      try {
        setQuoteNotice(null)
        setQuoteNoLiquidity(false)

        // USDC mode: route quote via MAH (USD → MAH bridge → to token swap)
        if (from === 'USDC') {
          const usdAmt = Number(amtStr)
          const mahNeeded = usdAmt * MAH_PER_USDC
          // Use combined aaWallet + signer MAH for quote accuracy
          const mahFromExisting = Math.min(mahForUsdNum + signerMahNum, mahNeeded)
          const usdcToBridge = Math.max(0, (mahNeeded - mahFromExisting) / MAH_PER_USDC)
          const bridgeFee = usdcToBridge > 0
            ? Math.min(BRIDGE_FEE_MAX_USD, Math.max(BRIDGE_FEE_MIN_USD, usdcToBridge * BRIDGE_FEE_BPS / 10000))
            : 0
          const netMah = mahFromExisting + Math.max(0, usdcToBridge - bridgeFee) * MAH_PER_USDC
          if (netMah <= 0) { setQuoteOut('—'); setMinOut('—'); return }

          // USD → MAH: bridge output IS the result, no AMM step
          if (to === 'MAH') {
            setQuoteOut(fmtNum(netMah.toFixed(6)))
            setMinOut(fmtNum(netMah.toFixed(6)))
            setQuoteNoLiquidity(false)
            setQuoteNotice(null)
            return
          }

          const mahToken = getToken('MAH')
          const B = getToken(to)
          if (!mahToken || !B) { setQuoteOut('—'); setMinOut('—'); return }

          const guard = await liquidityGuard(provider, mahToken, B, 'MAH', to)
          if (guard.blocked) {
            setQuoteNoLiquidity(true)
            setQuoteNotice(guard.reason)
            setQuoteOut('—')
            setMinOut('—')
            return
          }

          const mahDec = await readDecimals(mahToken, provider)
          const toDec = await readDecimals(B, provider)
          const mahIn = ethers.parseUnits(netMah.toFixed(6), mahDec)
          const { path, amountOut } = await getQuoteOut({ from: mahToken, to: B, amountIn: mahIn })
          const outMin = applySlippage(amountOut, slippageBps)
          setQuoteOut(fmtNum(ethers.formatUnits(amountOut, toDec)))
          setMinOut(fmtNum(ethers.formatUnits(outMin, toDec)))
          void path
          return
        }

        const A = getToken(from)
        const B = getToken(to)
        if (!A || !B) { setQuoteOut('—'); setMinOut('—'); return }

        // ✅ dust/no-pool gate
        const guard = await liquidityGuard(provider, A, B, from, to)
        if (guard.blocked) {
          setQuoteNoLiquidity(true)
          setQuoteNotice(guard.reason)
          setQuoteOut('—')
          setMinOut('—')
          return
        }

        const fromDec = await readDecimals(A, provider)
        const toDec = await readDecimals(B, provider)

        const amountIn = ethers.parseUnits(amtStr, fromDec)
        const { path, amountOut } = await getQuoteOut({ from: A, to: B, amountIn })

        const outMin = applySlippage(amountOut, slippageBps)

        setQuoteOut(fmtNum(ethers.formatUnits(amountOut, toDec)))
        setMinOut(fmtNum(ethers.formatUnits(outMin, toDec)))
        void path
      } catch (e: any) {
        setQuoteOut('—')
        setMinOut('—')

        const raw = tryDecodeRevert(e)
        const msg = String(e?.shortMessage || e?.message || raw || 'Quote failed.')

        const A = from === 'USDC' ? getToken('MAH') : getToken(from)
        const B = getToken(to)

        if (A && B && (msg.toLowerCase().includes('unknown custom error') || msg.toLowerCase().includes('execution reverted'))) {
          const noLp = await detectNoLiquidity(provider, A, B)
          if (noLp) {
            setQuoteNoLiquidity(true)
            setQuoteNotice(`No liquidity pool for ${from}/${to} yet. Try another pair or add liquidity.`)
            return
          }
        }

        if (isNoLiquidityLike(msg) || isNoLiquidityLike(raw)) {
          setQuoteNoLiquidity(true)
          setQuoteNotice(`No liquidity pool for ${from}/${to} yet. Try another pair or add liquidity.`)
        } else {
          setQuoteNoLiquidity(false)
          setQuoteNotice(msg)
        }
      }


    }, 250)

    return () => {
      if (quoteTimer.current) window.clearTimeout(quoteTimer.current)
    }
  }, [amount, from, to, slippageBps, address, provider])



  async function onDeposit() {
    if (!address) { setDepositErr('Connect your wallet first so Coinbase can send USDC to your address.'); return }
    setDepositLoading(true)
    setDepositErr(null)
    try {
      const challengeRes = await fetch('https://auth.alkebuleum.com/v1/siwe/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId: ALK_CHAIN_ID }),
      })
      const challengeData = await challengeRes.json().catch(() => null)
      if (!challengeData?.challengeId || !challengeData?.message) {
        throw new Error(challengeData?.error || 'Failed to get auth challenge.')
      }
      const signature = await sessionSignMessage(
        { chainId: ALK_CHAIN_ID, message: challengeData.message },
        { app: APP_NAME, amvaultUrl: AMVAULT_URL },
      )
      const verifyRes = await fetch('https://auth.alkebuleum.com/v1/siwe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId: challengeData.challengeId, message: challengeData.message, signature }),
      })
      const verifyData = await verifyRes.json().catch(() => null)
      if (!verifyData?.token) throw new Error(verifyData?.error || 'Auth verification failed.')

      const res = await fetch(`${BRIDGE_API}/coinbase/onramp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${verifyData.token}` },
        body: JSON.stringify({ walletAddress: address, sourceAmount: '20', returnUrl: 'https://jollofswap.com/swap' }),
      })
      const data = await res.json().catch(() => null)
      if (!data?.ok || !data?.onrampUrl) throw new Error(data?.error || 'Could not create Coinbase onramp session.')
      window.location.href = data.onrampUrl
    } catch (e: any) {
      setDepositErr(e?.message || 'Could not open Coinbase. Please try again.')
    } finally {
      setDepositLoading(false)
    }
  }

  async function onSwap() {
    setErr(null)
    setSwapDialogErr(null)
    setSwapDialogDetails(null)
    setBusy(true)
    let dialogOpened = false

    try {
      if (!walletConnected || !address) throw new Error('Connect your wallet to continue.')
      if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')
      const amtStr = clampAmountStr(amount.trim())
      if (!amtStr || Number(amtStr) <= 0) throw new Error('Enter a valid amount.')

      // ─── USDC smart-route mode ─────────────────────────────────────────────
      if (from === 'USDC') {
        const amtUsd = Number(amtStr)

        if (amtUsd > totalUsdNum + 0.01) {
          throw new Error(`Insufficient balance. You have $${totalUsdNum.toFixed(2)}.`)
        }

        // USD→MAH is a pure bridge — no AMM liquidity needed
        const isBridgeOnly = to === 'MAH'
        if (!isBridgeOnly && quoteNoLiquidity) throw new Error('No liquidity for this pair. Add liquidity or pick another.')

        const toToken = isBridgeOnly ? null : getToken(to)
        if (!isBridgeOnly && !toToken) throw new Error('Token registry still loading.')

        // Alkebuleum recipient: AA wallet if available, else EOA
        const alkRecipient = aaWallet ?? address

        const injectedEthSwap = typeof window !== 'undefined' ? (window as any).ethereum : null
        const isNuroBrowserSwap = injectedEthSwap?._isNuruWallet === true
        // Combined balance: aaWallet + signer (signer will be deposited before swap in QR mode)
        const mahAvail = mahForUsdNum + signerMahNum
        const mahNeeded = amtUsd * MAH_PER_USDC
        const mahFromExisting = Math.min(mahAvail, mahNeeded)
        const usdcToBridge = Math.max(0, (mahNeeded - mahFromExisting) / MAH_PER_USDC)
        const bridgeFee = usdcToBridge > 0
          ? Math.min(BRIDGE_FEE_MAX_USD, Math.max(BRIDGE_FEE_MIN_USD, usdcToBridge * BRIDGE_FEE_BPS / 10000))
          : 0
        const netMah = mahFromExisting + Math.max(0, usdcToBridge - bridgeFee) * MAH_PER_USDC
        if (netMah <= 0) throw new Error('Amount too small after fees.')

        setSwapDialogDetails({ fromSym: 'USD', toSym: to, amountIn: amtStr, estimatedOut: quoteOut !== '—' ? quoteOut : '—', txHash: '' })
        setSwapDialogPhase('waiting')
        setSwapDialogOpen(true)
        dialogOpened = true

        // mahAfterBridge tracks aaWallet-only MAH; signer portion added after auto-deposit
        let mahAfterBridge = mahForUsdNum

        // ── Bridge step (only when USDC is needed) ───────────────────────
        if (usdcToBridge > 0.001) {
          if (usdcToBridge > usdcBalNum + 0.01) {
            throw new Error(`Not enough USDC. Need $${usdcToBridge.toFixed(2)}, have $${usdcBalNum.toFixed(2)}.`)
          }

          setSwapDialogPhase('bridging')
          startFlow(isBridgeOnly ? 'bridge' : 'bridge+swap')

          const usdcDec: number = Number(await polyProvider.call({
            to: USDC_POLY, data: ERC20_WRITE_IFACE.encodeFunctionData('decimals', []),
          }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('decimals', d)[0]))
          const usdcAmt = ethers.parseUnits(usdcToBridge.toFixed(usdcDec), usdcDec)

          const bridgeResults = await sessionSendTransactions({
            chainId: POLY_CHAIN_ID,
            txs: [
              // Gas limits: 150k approve (USDC proxy uses ~64k+), 250k deposit (vault overhead)
              { to: USDC_POLY, data: ERC20_WRITE_IFACE.encodeFunctionData('approve', [BRIDGEVAULT_POLY, usdcAmt]), value: 0, gas: 150_000 },
              { to: BRIDGEVAULT_POLY, data: BRIDGEVAULT_IFACE.encodeFunctionData('deposit', [usdcAmt, alkRecipient]), value: 0, gas: 250_000 },
            ],
            failFast: true,
            preflight: BRIDGE_PREFLIGHT,
          } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL, keepPopupOpen: !isBridgeOnly }, 'bridge')

          const bridgeFail = bridgeResults?.find((r: any) => r?.ok === false)
          if (bridgeFail) throw new Error(bridgeFail.error || 'Bridge transaction failed')
          const depositHash = bridgeResults[bridgeResults.length - 1]?.txHash
          if (!depositHash) throw new Error('No bridge transaction hash returned')

          setSwapDialogDetails(prev => prev ? { ...prev, txHash: depositHash } : prev)
          setSwapDialogPhase('minting')

          // ── Wait for MAH to arrive on Alkebuleum ─────────────────────
          await (async () => {
            for (let i = 0; i < 150; i++) {
              await sleep(4000)
              try {
                const res = await fetch(`${BRIDGE_API}/deposits/${depositHash}?t=${Date.now()}`, { cache: 'no-store' })
                const data = await res.json().catch(() => null)
                if (res.ok && data?.ok) {
                  const deps = Array.isArray(data?.deposits) ? data.deposits : []
                  const mintHash = data?.mintTxHash || data?.mintedTxHash || deps.find((d: any) => d?.mintTxHash)?.mintTxHash || null
                  if (mintHash || data?.mintedAt) return
                }
              } catch { /* keep polling */ }
              try {
                const raw: bigint = BigInt(await provider.call({
                  to: MAH_TOKEN_ALK,
                  data: ERC20_WRITE_IFACE.encodeFunctionData('balanceOf', [alkRecipient]),
                }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('balanceOf', d)[0]))
                const dec: number = Number(await provider.call({
                  to: MAH_TOKEN_ALK,
                  data: ERC20_WRITE_IFACE.encodeFunctionData('decimals', []),
                }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('decimals', d)[0]))
                const nowMah = Number(ethers.formatUnits(raw, dec))
                // Compare against aaWallet-only baseline so signer MAH doesn't inflate threshold
                if (nowMah > mahForUsdNum + 0.1) { mahAfterBridge = nowMah; return }
              } catch { /* keep polling */ }
            }
          })()

          try {
            const raw: bigint = BigInt(await provider.call({
              to: MAH_TOKEN_ALK,
              data: ERC20_WRITE_IFACE.encodeFunctionData('balanceOf', [alkRecipient]),
            }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('balanceOf', d)[0]))
            const dec: number = Number(await provider.call({
              to: MAH_TOKEN_ALK,
              data: ERC20_WRITE_IFACE.encodeFunctionData('decimals', []),
            }).then(d => ERC20_WRITE_IFACE.decodeFunctionResult('decimals', d)[0]))
            mahAfterBridge = Number(ethers.formatUnits(raw, dec))
            setMahForUsdNum(mahAfterBridge)
            setUsdcBalNum(prev => Math.max(0, prev - usdcToBridge))
          } catch { /* non-fatal */ }
        }

        // ── Pure bridge: USD → MAH (no AMM swap) ────────────────────────
        if (isBridgeOnly) {
          setSwapDialogPhase('success')
          return
        }

        // ── Auto-deposit: sweep signer MAH into aaWallet (QR path only) ─────
        // Mirrors Nuru wallet: combined balance is shown, but swaps execute from aaWallet.
        // Skipped in Nuru browser mode — window.ethereum already routes through aaWallet.
        const signerMahSnap = signerMahRef.current
        if (
          !isNuroBrowserSwap &&
          polyAddress &&
          polyAddress.toLowerCase() !== alkRecipient.toLowerCase() &&
          signerMahSnap &&
          signerMahSnap.raw > 0n
        ) {
          setSwapDialogPhase('consolidating')
          try {
            const transferData = ERC20_WRITE_IFACE.encodeFunctionData('transfer', [alkRecipient, signerMahSnap.raw])
            await sessionSendTransactions(
              { chainId: ALK_CHAIN_ID, txs: [{ to: MAH_TOKEN_ALK, data: transferData, value: 0, gas: 80_000 }], failFast: true },
              { app: APP_NAME, amvaultUrl: AMVAULT_URL, skipAaWrap: true },
              'Consolidate wallet',
            )
            // mahAfterBridge already reflects any bridged MAH; add signer deposit on top
            mahAfterBridge = mahAfterBridge + Number(ethers.formatUnits(signerMahSnap.raw, signerMahSnap.dec))
            signerMahRef.current = null
          } catch (e) {
            // Non-fatal: proceed with aaWallet-only balance
            console.warn('[Jollof] Signer MAH deposit failed, continuing with aaWallet balance only:', e)
          }
        }

        // After all deposits: verify aaWallet has enough MAH to cover the swap
        if (mahAfterBridge < netMah - 0.001) {
          throw new Error(
            `Not enough MAH in your account. Have ${mahAfterBridge.toFixed(2)} MAH, need ${netMah.toFixed(2)} MAH.`
          )
        }

        // ── Swap step: MAH → to token ────────────────────────────────────
        const mahToken = getToken('MAH')
        if (!mahToken) throw new Error('MAH token not in registry.')

        setSwapDialogPhase('confirming')
        const mahDec = await readDecimals(mahToken, provider)
        const toDec = await readDecimals(toToken!, provider)
        const mahIn = ethers.parseUnits(Math.min(netMah, mahAfterBridge).toFixed(6), mahDec)
        const { path, amountOut } = await getQuoteOut({ from: mahToken, to: toToken!, amountIn: mahIn })
        const amountOutMin = applySlippage(amountOut, slippageBps)

        const swapTxs: any[] = []
        const allowance = await getAllowance(alkRecipient, mahToken, ROUTER, provider)
        if (allowance < mahIn) {
          const approveTx = buildApproveTx(mahToken, ROUTER, mahIn)
          if (approveTx) swapTxs.push(approveTx)
        }
        swapTxs.push(buildSwapTx({ from: mahToken, to: toToken!, amountIn: mahIn, amountOutMin, path, recipient: alkRecipient, deadlineSec: 10 * 60 }))

        setPreSwapBals({ from: `$${totalUsdNum.toFixed(2)}`, to: toBal })

        const swapResults = await sessionSendTransactions({
          chainId: ALK_CHAIN_ID, txs: swapTxs.map(normalizeTx), failFast: true, preflight: SWAP_PREFLIGHT,
        } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'swap')

        const swapFail = swapResults?.find((r: any) => r?.ok === false)
        if (swapFail) throw new Error(swapFail.error || 'Swap transaction failed')

        const swapHash: string = swapResults[swapResults.length - 1]?.txHash ?? ''
        setSwapDialogDetails(prev => prev ? { ...prev, txHash: swapHash, estimatedOut: quoteOut !== '—' ? quoteOut : fmtNum(ethers.formatUnits(amountOut, toDec)) } : prev)

        let lastReason: string | null = null
        let swapReceipt: ethers.TransactionReceipt | null = null
        for (const h of (swapResults || []).map((r: any) => r?.txHash).filter(Boolean)) {
          const r = await waitForReceipt(provider, h)
          if (!r) { lastReason = 'Not confirmed (timeout)'; break }
          if (r.status === 0) { lastReason = (await getRevertReasonFromChain(provider, h)) ?? 'reverted'; break }
          if (h === swapHash) swapReceipt = r
        }

        if (lastReason) { setSwapDialogPhase('error'); setSwapDialogErr(`Swap reverted: ${lastReason}`) }
        else {
          if (swapReceipt) await logAmmEventsFromReceipt({ provider, chainId: ALK_CHAIN_ID, receipt: swapReceipt, action: 'swap', user: alkRecipient, ain: ainLoading ? null : (ain ?? null), tokenA: 'MAH', tokenB: to, pairHint: null })
          setSwapDialogPhase('success')
        }
        window.setTimeout(async () => {
          try {
            const b2 = await getBalance(alkRecipient, toToken!, provider)
            setToBal(fmtNum(ethers.formatUnits(b2, toDec)))
          } catch { }
        }, 2500)
        return
      }

      // ─── Regular token-to-token swap ──────────────────────────────────────
      if (from === to) throw new Error('Select different tokens.')

      if (fromBalNum > 0 && Number(amtStr) > fromBalNum) {
        throw new Error(`Insufficient ${from} balance. You have ${fromBal} ${from}.`)
      }
      if (quoteNoLiquidity) throw new Error(`No liquidity pool for ${from}/${to} yet. Add liquidity or pick another pair.`)

      const fromToken = getToken(from)
      const toToken = getToken(to)
      if (!fromToken || !toToken) throw new Error('Token registry is still loading. Try again.')

      const fromDec = await readDecimals(fromToken, provider)
      const toDec = await readDecimals(toToken, provider)
      const amountIn = ethers.parseUnits(amtStr, fromDec)
      const { path, amountOut } = await getQuoteOut({ from: fromToken, to: toToken, amountIn })
      const amountOutMin = applySlippage(amountOut, slippageBps)

      // Use AA wallet for Alkebuleum allowance checks and swap recipient
      const alkAddress = aaWallet ?? address
      const signerAlkDirect = polyAddress && polyAddress.toLowerCase() !== alkAddress.toLowerCase()
        ? polyAddress : null

      // ── Auto-deposit: sweep signer's from-token into aaWallet before swap ──
      // Mirrors Nuru wallet: ERC-20 → full sweep; native ALKE → keep 0.5 ALKE gas buffer.
      // Skipped in Nuru browser mode (window.ethereum already routes through aaWallet).
      const injEthDirect = typeof window !== 'undefined' ? (window as any).ethereum : null
      const isNuroBrowserDirect = injEthDirect?._isNuruWallet === true
      if (!isNuroBrowserDirect && signerAlkDirect) {
        if (fromToken.isNative) {
          const ALKE_GAS_BUFFER = ethers.parseEther('0.5')
          const signerAlkeBal = await provider.getBalance(signerAlkDirect).catch(() => 0n)
          const depositable = signerAlkeBal > ALKE_GAS_BUFFER ? signerAlkeBal - ALKE_GAS_BUFFER : 0n
          if (depositable > 0n) {
            try {
              await sessionSendTransactions(
                { chainId: ALK_CHAIN_ID, txs: [{ to: alkAddress, data: '0x', value: depositable.toString(), gas: 21_000 }], failFast: false },
                { app: APP_NAME, amvaultUrl: AMVAULT_URL, skipAaWrap: true },
                'Consolidate wallet',
              )
            } catch (e) { console.warn('[Jollof] Signer ALKE deposit failed:', e) }
          }
        } else {
          const signerTokenBal = await getBalance(signerAlkDirect, fromToken, provider).catch(() => 0n)
          if (signerTokenBal > 0n) {
            try {
              const transferData = ERC20_WRITE_IFACE.encodeFunctionData('transfer', [alkAddress, signerTokenBal])
              await sessionSendTransactions(
                { chainId: ALK_CHAIN_ID, txs: [{ to: fromToken.address, data: transferData, value: 0, gas: 80_000 }], failFast: false },
                { app: APP_NAME, amvaultUrl: AMVAULT_URL, skipAaWrap: true },
                'Consolidate wallet',
              )
            } catch (e) { console.warn('[Jollof] Signer token deposit failed:', e) }
          }
        }
      }

      const txs: any[] = []
      if (!fromToken.isNative) {
        const allowance = await getAllowance(alkAddress, fromToken, ROUTER, provider)
        if (allowance < amountIn) {
          const approveTx = buildApproveTx(fromToken, ROUTER, amountIn)
          if (approveTx) txs.push(approveTx)
        }
      }
      txs.push(buildSwapTx({ from: fromToken, to: toToken, amountIn, amountOutMin, path, recipient: alkAddress, deadlineSec: 10 * 60 }))

      setPreSwapBals({ from: fromBal, to: toBal })
      const results = await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: txs.map(normalizeTx), failFast: true, preflight: SWAP_PREFLIGHT } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'swap')

      const firstFail = results?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const hashes: string[] = (results || []).map((r: any) => r?.txHash as string | undefined).filter(Boolean) as string[]
      const swapHash = hashes[hashes.length - 1]

      setSwapDialogDetails({ fromSym: from, toSym: to, amountIn: amtStr, estimatedOut: quoteOut !== '—' ? quoteOut : fmtNum(ethers.formatUnits(amountOut, toDec)), txHash: swapHash })
      setSwapDialogPhase('confirming')
      setSwapDialogOpen(true)
      dialogOpened = true

      let lastReason: string | null = null
      let swapReceipt: ethers.TransactionReceipt | null = null
      for (const h of hashes) {
        const r = await waitForReceipt(provider, h)
        if (!r) { lastReason = 'Not confirmed (timeout)'; break }
        if (r.status === 0) { lastReason = (await getRevertReasonFromChain(provider, h)) ?? 'reverted (no reason decoded)'; break }
        if (h === swapHash) swapReceipt = r
      }

      if (lastReason) { setSwapDialogPhase('error'); setSwapDialogErr(`Swap reverted: ${lastReason}`) }
      else {
        if (swapReceipt) await logAmmEventsFromReceipt({ provider, chainId: ALK_CHAIN_ID, receipt: swapReceipt, action: 'swap', user: alkAddress, ain: ainLoading ? null : (ain ?? null), tokenA: from, tokenB: to, pairHint: null })
        setSwapDialogPhase('success')
      }
      window.setTimeout(async () => {
        if (!address) return
        try {
          const [b1, b2] = await Promise.all([getBalance(alkAddress, fromToken, provider), getBalance(alkAddress, toToken, provider)])
          const fromRaw = ethers.formatUnits(b1, fromDec)
          setFromBal(fmtNum(fromRaw)); setFromBalNum(Number(fromRaw)); setToBal(fmtNum(ethers.formatUnits(b2, toDec)))
        } catch { }
      }, 2500)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Swap failed.'
      if (dialogOpened) { setSwapDialogErr(msg); setSwapDialogPhase('error') }
      else setErr(msg)
    } finally {
      endFlow()  // clear flowId whether bridge+swap succeeded or failed
      setBusy(false)
    }
  }

  const fromBalDisplay = hideBalances ? '•••' : (loadingBalances ? '…' : fromBal)
  const toBalDisplay = hideBalances ? '•••' : (loadingBalances ? '…' : toBal)

  // Derived USD / rate values — no extra API calls, uses the existing AMM quote
  const amtNumVal = Number(clampAmountStr(amount.trim()) || '0')
  const quoteNumVal = quoteOut === '—' ? NaN : Number(quoteOut.replace(/,/g, ''))
  const spotRate = amtNumVal > 0 && !isNaN(quoteNumVal) && quoteNumVal > 0
    ? isUsdcMode
      // In USDC mode quoteOut is for netMah ≈ amtNumVal*MAH_PER_USDC MAH,
      // so divide by MAH_PER_USDC to get back to ALKE-per-MAH.
      ? (quoteNumVal / amtNumVal) / MAH_PER_USDC
      : quoteNumVal / amtNumVal
    : null

  // USD value of the amount being spent
  const usdValue: number | null =
    from.toUpperCase() === STABLE_SYM && amtNumVal > 0
      ? amtNumVal * STABLE_USD_PRICE
      : to.toUpperCase() === STABLE_SYM && !isNaN(quoteNumVal) && quoteNumVal > 0
        ? quoteNumVal * STABLE_USD_PRICE
        : null

  // USD price of the non-stable token (shown in the rate pill)
  // from=MAH, spotRate=25 ALKE/MAH → 1 ALKE = $0.01/25 = $0.0004
  // to=MAH,   spotRate=0.04 MAH/ALKE → 1 ALKE = 0.04 × $0.01 = $0.0004
  const nonStableSym = from.toUpperCase() === STABLE_SYM ? to : from
  const altUsdPerToken: number | null =
    from.toUpperCase() === STABLE_SYM && spotRate !== null && spotRate > 0
      ? STABLE_USD_PRICE / spotRate
      : to.toUpperCase() === STABLE_SYM && spotRate !== null && spotRate > 0
        ? spotRate * STABLE_USD_PRICE
        : null

  // USD hint passed to the chart (shown as secondary "≈ $X per TOKEN" line)
  const chartUsdHint = altUsdPerToken !== null
    ? { sym: nonStableSym, price: altUsdPerToken }
    : undefined

  // In USD mode: scale MAH/to prices → USD/to by multiplying by MAH_PER_USDC
  const chartData = useMemo(
    () => isUsdcMode ? priceData.map(d => ({ t: d.t, p: d.p * MAH_PER_USDC })) : priceData,
    [priceData, isUsdcMode]
  )

  // Close settings popover on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false)
    }
    if (settingsOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  // Close token modal on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') setTokenModalFor(null) }
    if (tokenModalFor) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tokenModalFor])

  function tokenColor(sym: string): string {
    const s = sym.toUpperCase()
    const m: Record<string, string> = {
      ALKE: 'linear-gradient(135deg,#8B5CF6,#a78bfa)',
      MAH: 'linear-gradient(135deg,#F7B53B,#e09c25)',
      JLF: 'linear-gradient(135deg,#FF5A3C,#ff7a4d)',
      USDC: 'linear-gradient(135deg,#2775CA,#4a93e8)',
      USDT: 'linear-gradient(135deg,#26A17B,#3fc497)',
      WAKE: 'linear-gradient(135deg,#8B5CF6,#c4b5fd)',
    }
    return m[s] || 'linear-gradient(135deg,var(--red),var(--gold))'
  }

  function tokenGlyph(sym: string): string {
    const s = sym.toUpperCase()
    const m: Record<string, string> = { ALKE: 'A', MAH: 'M', JLF: 'J', USDC: '$', USDT: '₮', WAKE: 'W' }
    return m[s] || s.slice(0, 1)
  }

  return (
    <>
      <div className="jlf-app">

        {/* LEFT: Price chart — ModernPriceChart owns its own header */}
        <div className="jlf-panel jlf-chart-panel" style={{ height: '100%' }}>
          <ModernPriceChart
            data={chartData}
            symbolFrom={isUsdcMode ? 'MAH' : from}
            symbolTo={to}
            usdHint={chartUsdHint}
          />
        </div>

        {/* RIGHT: Swap card */}
        <div className="jlf-swap-card jlf-swap-col">

          {/* Header: tabs + settings gear */}
          <div className="jlf-swap-top" ref={settingsRef}>
            <div className="jlf-stabs">
              <button className="active">Swap</button>
            </div>
            <div className="jlf-stools">
              <button
                className="jlf-gear"
                onClick={() => setSettingsOpen(v => !v)}
                aria-label="Settings"
              >
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/>
                  <path d="M19.4 13.5a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.18-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-2.18 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 002.18.33H9.5a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 2.18V12a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <span className="jlf-slip-badge">{(slippageBps / 100).toFixed(2)}%</span>
              </button>
            </div>

            {/* Settings popover */}
            <div className={`jlf-pop${settingsOpen ? ' open' : ''}`}>
              <h4>Max slippage</h4>
              <div className="jlf-slips">
                {[30, 50, 100].map((bps) => (
                  <button
                    key={bps}
                    className={slippageBps === bps ? 'active' : ''}
                    onClick={() => { setSlippageBps(bps); setSettingsOpen(false) }}
                  >
                    {(bps / 100).toFixed(2)}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sell leg */}
          <div className="jlf-leg">
            <div className="jlf-leg-top">
              <span className="lab">Sell</span>
              <span className="bal">
                Balance:&nbsp;
                <b>
                  {isUsdcMode ? (
                    <button
                      type="button"
                      onClick={() => setUsdBalInfoOpen(true)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: '"DM Mono"', fontSize: 12.5, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    >
                      {hideBalances ? '•••' : (loadingUsdBal ? '…' : `$${totalUsdNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)}
                      <Info style={{ width: 11, height: 11, opacity: 0.6 }} />
                    </button>
                  ) : fromBalDisplay}
                </b>
              </span>
            </div>
            <div className="jlf-leg-row">
              <input
                className="jlf-amt"
                value={amount}
                onChange={(e) => setAmount(clampAmountStr(e.target.value))}
                placeholder="0"
                inputMode="decimal"
              />
              <button
                className="jlf-tokbtn"
                onClick={() => { setTokenSearch(''); setTokenModalFor('from') }}
              >
                <span className="jlf-tcoin" style={{ background: tokenColor(isUsdcMode ? 'USDC' : from), width: 26, height: 26, fontSize: 11 }}>
                  {tokenGlyph(isUsdcMode ? 'USDC' : from)}
                </span>
                <b>{isUsdcMode ? 'USD' : from}</b>
                <span className="caret">▾</span>
              </button>
            </div>
            <div className="jlf-leg-sub">
              <span>
                {!isUsdcMode && usdValue !== null
                  ? `≈ $${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : null}
              </span>
              {!isUsdcMode && (
                <span
                  className="jlf-max"
                  onClick={() => {
                    const bal = fromBal.replace(/,/g, '')
                    if (bal && bal !== '—' && !isNaN(Number(bal))) setAmount(bal)
                  }}
                >
                  Max
                </span>
              )}
            </div>
          </div>

          {/* Flip button */}
          <div className="jlf-flip">
            <button
              onClick={() => { setErr(null); if (isUsdcMode) { setFrom('MAH') } else { setFrom(to); setTo(from) } }}
              title="Flip tokens"
              aria-label="Switch tokens"
            >
              <ArrowDownUp style={{ width: 16, height: 16 }} />
            </button>
          </div>

          {/* Buy leg */}
          <div className="jlf-leg" style={{ marginTop: 6 }}>
            <div className="jlf-leg-top">
              <span className="lab">Buy</span>
              <span className="bal">Balance:&nbsp;<b>{toBalDisplay}</b></span>
            </div>
            <div className="jlf-leg-row">
              <div className="jlf-amt" style={{ cursor: 'default' }}>
                {quoteOut !== '—' ? quoteOut : <span style={{ color: '#393834' }}>0</span>}
              </div>
              <button
                className="jlf-tokbtn"
                onClick={() => { setTokenSearch(''); setTokenModalFor('to') }}
              >
                <span className="jlf-tcoin" style={{ background: tokenColor(to), width: 26, height: 26, fontSize: 11 }}>
                  {tokenGlyph(to)}
                </span>
                <b>{to}</b>
                <span className="caret">▾</span>
              </button>
            </div>
            <div className="jlf-leg-sub">
              <span>
                {usdValue !== null
                  ? `≈ $${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : minOut !== '—' ? `Min ${minOut} ${to}` : null}
              </span>
            </div>
          </div>

          {/* Error / notice */}
          {quoteNotice && (
            <div style={{ margin: '6px 0', padding: '10px 14px', background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.18)', borderRadius: 14, fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: 'var(--white)' }}>{quoteNoLiquidity ? 'No liquidity yet' : 'Quote notice'}</span>
              <span style={{ color: 'var(--muted)', marginLeft: 8 }}>{quoteNotice}</span>
              {quoteNoLiquidity && (
                <Link to={`/liquidity?a=${encodeURIComponent(from)}&b=${encodeURIComponent(to)}`} style={{ marginLeft: 8, color: 'var(--gold)', fontWeight: 600 }}>
                  Add Liquidity →
                </Link>
              )}
            </div>
          )}

          {err && (
            <div style={{ margin: '6px 0', padding: '10px 14px', background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.22)', borderRadius: 14, fontSize: 13, color: 'var(--red)', whiteSpace: 'pre-wrap' }}>
              {err}
            </div>
          )}

          {/* Details accordion */}
          {spotRate !== null && (
            <div className="jlf-details">
              <div className="jlf-det-row" onClick={() => setDetailsOpen(v => !v)}>
                <span className="l">
                  1&nbsp;{isUsdcMode ? 'MAH' : from}&nbsp;=&nbsp;{fmtRate(spotRate)}&nbsp;{to}
                </span>
                <span className="r">
                  <span>{(slippageBps / 100).toFixed(2)}% slip</span>
                  <span className="ex" style={{ display: 'inline-block', transform: detailsOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </span>
              </div>
              <div className={`jlf-det-body${detailsOpen ? ' open' : ''}`}>
                <div className="jlf-det-line">
                  <span className="k">Slippage tolerance</span>
                  <span className="v">{(slippageBps / 100).toFixed(2)}%</span>
                </div>
                {minOut !== '—' && (
                  <div className="jlf-det-line">
                    <span className="k">Min. received</span>
                    <span className="v">{minOut} {to}</span>
                  </div>
                )}
                {altUsdPerToken !== null && (
                  <div className="jlf-det-line">
                    <span className="k">1 {nonStableSym} price</span>
                    <span className="v good">≈ ${fmtUsd(altUsdPerToken)}</span>
                  </div>
                )}
                <div className="jlf-det-line">
                  <span className="k">Route</span>
                  <span className="v">
                    <span className="jlf-route-chips">
                      {isUsdcMode && (
                        <>
                          <span className="jlf-rc">USDC</span>
                          <span className="jlf-rc-arr">→</span>
                          <span className="jlf-rc">MAH</span>
                          <span className="jlf-rc-arr">→</span>
                        </>
                      )}
                      <span className="jlf-rc">{isUsdcMode ? 'MAH' : from}</span>
                      <span className="jlf-rc-arr">→</span>
                      <span className="jlf-rc">{to}</span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Action button */}
          {(() => {
            if (!walletConnected || !address) {
              return (
                <button className="jlf-action" onClick={openModal}>
                  Connect Wallet
                </button>
              )
            }
            const amtNum = Number(clampAmountStr(amount.trim()))
            const insufficientBal = isUsdcMode
              ? !loadingUsdBal && amtNum > 0 && amtNum > totalUsdNum + 0.01
              : !loadingBalances && amtNum > 0 && amtNum > fromBalNum

            const btnClass = insufficientBal
              ? 'jlf-action warn'
              : busy || quoteNoLiquidity || amtNum <= 0
                ? 'jlf-action idle'
                : 'jlf-action'

            return (
              <button
                className={btnClass}
                onClick={insufficientBal || quoteNoLiquidity || amtNum <= 0 ? undefined : onSwap}
                disabled={busy}
              >
                {busy
                  ? 'Processing…'
                  : insufficientBal
                    ? 'Insufficient balance'
                    : quoteNoLiquidity
                      ? 'No liquidity'
                      : amtNum <= 0
                        ? 'Enter an amount'
                        : 'Swap'}
              </button>
            )
          })()}

          {swapDialogDetails && !swapDialogOpen && (
            <button
              onClick={() => setSwapDialogOpen(true)}
              style={{ marginTop: 7, width: '100%', background: 'rgba(255,90,60,.1)', border: '1px solid rgba(255,90,60,.2)', borderRadius: 'var(--r)', padding: '12px', fontWeight: 600, fontSize: 14, color: 'var(--red)', cursor: 'pointer', fontFamily: '"Bricolage Grotesque"' }}
            >
              View swap status →
            </button>
          )}

          {/* Low USD balance — deposit CTA */}
          {walletConnected && isUsdcMode && !loadingUsdBal && amtNumVal > 0 && amtNumVal > totalUsdNum + 0.01 && (
            <div style={{ marginTop: 8, padding: '12px 14px', background: 'rgba(255,90,60,.07)', border: '1px solid rgba(255,90,60,.15)', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <CircleDollarSign style={{ width: 18, height: 18, color: 'var(--red)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--muted)' }}>
                Need ${amtNumVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, have ${totalUsdNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {depositErr && <span style={{ fontSize: 12, color: 'var(--red)' }}>{depositErr}</span>}
              <button
                onClick={onDeposit}
                disabled={depositLoading}
                style={{ flexShrink: 0, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: depositLoading ? 'default' : 'pointer', opacity: depositLoading ? 0.6 : 1 }}
              >
                {depositLoading ? 'Opening…' : 'Deposit'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Token selection modal */}
      <div
        className={`jlf-overlay${tokenModalFor ? ' open' : ''}`}
        onClick={() => setTokenModalFor(null)}
      >
        <div className="jlf-modal" onClick={e => e.stopPropagation()}>
          <div className="jlf-modal-head">
            <div className="row1">
              <h3>Select a token</h3>
              <button className="x" onClick={() => setTokenModalFor(null)}>✕</button>
            </div>
            <div className="jlf-search">
              <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
                <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input
                value={tokenSearch}
                onChange={e => setTokenSearch(e.target.value)}
                placeholder="Search name or paste address"
                autoComplete="off"
                autoFocus={!!tokenModalFor}
              />
            </div>
            <div className="jlf-popular">
              {(tokenModalFor === 'from'
                ? ['USDC', ...tokenOptions.slice(0, 4)]
                : tokenOptions.slice(0, 5)
              ).map(sym => (
                <button
                  key={sym}
                  className="jlf-ptok"
                  onClick={() => {
                    if (tokenModalFor === 'from') {
                      if (sym === to) setTo(from === 'USDC' ? (tokenOptions[0] ?? 'MAH') : from)
                      setFrom(sym)
                    } else {
                      if (sym === from) setFrom(to)
                      setTo(sym)
                    }
                    setTokenModalFor(null)
                  }}
                >
                  <span className="jlf-tcoin" style={{ background: tokenColor(sym), width: 22, height: 22, fontSize: 10 }}>
                    {tokenGlyph(sym)}
                  </span>
                  {sym === 'USDC' ? 'USD' : sym}
                </button>
              ))}
            </div>
          </div>
          <div className="jlf-tlist">
            {(tokenModalFor === 'from'
              ? [{ sym: 'USDC', name: 'USD · via USDC on Polygon' }, ...tokenOptions.map(s => ({ sym: s, name: (regTokens || []).find(t => t.symbol === s)?.name || s }))]
              : tokenOptions.map(s => ({ sym: s, name: (regTokens || []).find(t => t.symbol === s)?.name || s }))
            )
              .filter(({ sym, name }) => {
                const q = tokenSearch.toLowerCase()
                return !q || sym.toLowerCase().includes(q) || (name || '').toLowerCase().includes(q)
              })
              .map(({ sym, name }) => (
                <div
                  key={sym}
                  className="it"
                  onClick={() => {
                    if (tokenModalFor === 'from') {
                      if (sym === to) setTo(from === 'USDC' ? (tokenOptions[0] ?? 'MAH') : from)
                      setFrom(sym)
                    } else {
                      if (sym === from) setFrom(to)
                      setTo(sym)
                    }
                    setTokenModalFor(null)
                  }}
                >
                  <span className="jlf-tcoin" style={{ background: tokenColor(sym), flexShrink: 0 }}>
                    {tokenGlyph(sym)}
                  </span>
                  <span className="nm">
                    <b>{sym === 'USDC' ? 'USD' : sym}</b>
                    <small>{name}</small>
                  </span>
                  <span className="hold">
                    <b>
                      {sym === 'USDC'
                        ? (hideBalances ? '•••' : (loadingUsdBal ? '…' : `$${totalUsdNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`))
                        : sym === from ? fromBalDisplay
                        : sym === to ? toBalDisplay
                        : '—'}
                    </b>
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Swap progress modal */}
      {swapDialogOpen && swapDialogDetails && (
        <SwapProgressModal
          phase={swapDialogPhase}
          details={swapDialogDetails}
          preSwapBals={preSwapBals}
          fromBal={isUsdcMode ? `$${totalUsdNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fromBal}
          toBal={toBal}
          err={swapDialogErr}
          onClose={() => setSwapDialogOpen(false)}
        />
      )}

      {/* USD balance breakdown modal */}
      {usdBalInfoOpen && (
        <div className="jlf-overlay open" onClick={() => setUsdBalInfoOpen(false)}>
          <div className="jlf-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="jlf-modal-head">
              <div className="row1">
                <h3>USD Balance</h3>
                <button className="x" onClick={() => setUsdBalInfoOpen(false)}>✕</button>
              </div>
            </div>
            <div style={{ padding: '16px 20px 20px' }}>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
                Your estimated USD balance is the sum of USDC on Polygon and MAH on Alkebuleum, converted to USD.
              </p>
              <div style={{ border: '1px solid var(--line-2)', borderRadius: 14, overflow: 'hidden' }}>
                {[
                  { label: 'USDC', sub: 'On Polygon', value: `$${usdcBalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                  { label: 'MAH', sub: 'On Alkebuleum', value: `$${(mahForUsdNum / MAH_PER_USDC).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                  { label: 'Total', sub: '', value: `$${totalUsdNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, bold: true },
                ].map(({ label, sub, value, bold }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: label !== 'Total' ? '1px solid var(--line-2)' : 'none', background: bold ? 'rgba(255,255,255,.03)' : 'transparent' }}>
                    <div>
                      <div style={{ fontWeight: bold ? 700 : 600, color: 'var(--white)', fontSize: 14 }}>{label}</div>
                      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 2 }}>{sub}</div>}
                    </div>
                    <div style={{ fontFamily: '"DM Mono"', fontWeight: bold ? 700 : 500, color: 'var(--white)' }}>
                      {hideBalances ? '•••' : (loadingUsdBal ? '…' : value)}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5 }}>
                When you swap, funds are routed automatically — bridging from Polygon if needed.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      {children}
    </span>
  )
}

function SwapProgressModal({
  phase,
  details,
  preSwapBals,
  fromBal,
  toBal,
  err,
  onClose,
}: {
  phase: 'waiting' | 'consolidating' | 'bridging' | 'minting' | 'confirming' | 'success' | 'error'
  details: { fromSym: string; toSym: string; amountIn: string; estimatedOut: string; txHash: string }
  preSwapBals: { from: string; to: string } | null
  fromBal: string
  toBal: string
  err: string | null
  onClose: () => void
}) {
  const isDone = phase === 'success'
  const isError = phase === 'error'
  const isUsdFlow = details.fromSym === 'USD'
  const pastConsolidate = phase === 'bridging' || phase === 'minting' || phase === 'confirming' || isDone

  // Steps for USD smart-route flow (bridge + swap) — signatures required
  const usdSteps: Array<{ label: string; sublabel?: string; done: boolean; active: boolean }> = [
    {
      label: 'Consolidate wallet funds',
      sublabel: phase === 'consolidating' ? 'Moving MAH from signing wallet to your account…' : undefined,
      done: pastConsolidate,
      active: phase === 'waiting' || phase === 'consolidating',
    },
    {
      label: 'Signature — Bridge',
      sublabel: phase === 'bridging' ? 'Confirm in your wallet to send USDC to the bridge' : (phase === 'minting' || phase === 'confirming' || isDone) && details.txHash ? `${details.txHash.slice(0, 10)}…${details.txHash.slice(-6)}` : undefined,
      done: phase === 'minting' || phase === 'confirming' || isDone,
      active: phase === 'bridging',
    },
    {
      label: 'Funds arriving on Alkebuleum',
      sublabel: phase === 'minting' ? 'Usually takes 1–3 minutes…' : undefined,
      done: phase === 'confirming' || isDone,
      active: phase === 'minting',
    },
    {
      label: 'Signature — Swap',
      sublabel: phase === 'confirming' ? 'Confirm in your wallet to complete the swap' : isDone && details.txHash ? `${details.txHash.slice(0, 10)}…${details.txHash.slice(-6)}` : undefined,
      done: isDone,
      active: phase === 'confirming',
    },
    {
      label: 'Done',
      done: isDone,
      active: false,
    },
  ]

  // Steps for regular swap flow
  const regularSteps: Array<{ label: string; sublabel?: string; done: boolean; active: boolean }> = [
    {
      label: 'Transaction submitted',
      sublabel: details.txHash ? `${details.txHash.slice(0, 10)}…${details.txHash.slice(-6)}` : undefined,
      done: true,
      active: false,
    },
    {
      label: 'Awaiting confirmation',
      done: isDone,
      active: phase === 'confirming',
    },
    {
      label: 'Swap complete',
      done: isDone,
      active: false,
    },
  ]

  const steps = isUsdFlow ? usdSteps : regularSteps
  const isActive = steps.some(s => s.active)

  function headerTitle() {
    if (isDone) return 'Swap complete'
    if (isError) return 'Swap failed'
    if (isUsdFlow) {
      if (phase === 'waiting' || phase === 'bridging') return 'Step 1 of 2 — Bridge'
      if (phase === 'minting') return 'Funds on the way…'
      if (phase === 'confirming') return 'Step 2 of 2 — Swap'
    }
    return `Swapping ${details.fromSym} → ${details.toSym}`
  }
  function headerSub() {
    if (isDone) return `$${details.amountIn} → ~${details.estimatedOut} ${details.toSym}`
    if (isError) return 'See details below.'
    if (isUsdFlow) {
      if (phase === 'waiting' || phase === 'bridging') return 'amvault will ask you to sign — approve the bridge transaction.'
      if (phase === 'minting') return 'Waiting for USDC to arrive as MAH (usually 1–3 min)…'
      if (phase === 'confirming') return 'amvault will open again for the swap — sign in to approve it.'
    }
    return 'Waiting for confirmation…'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div
          className={[
            'px-5 py-4',
            isDone
              ? 'bg-green-50 dark:bg-green-950/30'
              : isError
                ? 'bg-red-50 dark:bg-red-950/30'
                : 'bg-orange-50 dark:bg-orange-950/20',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{headerTitle()}</div>
              <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{headerSub()}</div>
            </div>
            {(isDone || isError) && (
              <button
                onClick={onClose}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">

          {/* Step list */}
          {!isError && (
            <div>
              {steps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={[
                        'relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                        step.done
                          ? 'bg-green-500 text-white'
                          : step.active
                            ? 'bg-orange-500 text-white'
                            : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
                      ].join(' ')}
                    >
                      {step.active && (
                        <span className="absolute inset-0 animate-ping rounded-full bg-orange-400 opacity-40" />
                      )}
                      {step.done ? (
                        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : step.active ? (
                        <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
                          <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <span>{i + 1}</span>
                      )}
                    </div>
                    {i < steps.length - 1 && (
                      <div
                        className={[
                          'my-1 w-0.5',
                          step.done ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-700',
                        ].join(' ')}
                        style={{ minHeight: 20 }}
                      />
                    )}
                  </div>

                  <div className="min-w-0 pb-5">
                    <div
                      className={[
                        'text-sm font-semibold',
                        step.done
                          ? 'text-green-700 dark:text-green-400'
                          : step.active
                            ? 'text-orange-700 dark:text-orange-400'
                            : 'text-slate-400 dark:text-slate-600',
                      ].join(' ')}
                    >
                      {step.label}
                    </div>
                    {step.sublabel && (
                      <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {step.sublabel}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error panel */}
          {isError && err && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/30">
              <div className="mb-1 text-sm font-semibold text-red-700 dark:text-red-400">Error</div>
              <div className="whitespace-pre-wrap text-sm text-red-600 dark:text-red-300">{err}</div>
            </div>
          )}

          {/* Live balances card */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="mb-3 flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {isDone ? 'Updated balances' : 'Live balances'}
              </div>
              {isActive && (
                <span className="flex items-center gap-1">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
                  </span>
                  <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400">live</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* From token */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500 dark:text-slate-400">{details.fromSym}</div>
                <div className={[
                  'mt-1 text-lg font-bold tabular-nums',
                  isDone ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100',
                ].join(' ')}>
                  {fromBal}
                </div>
                {isDone && preSwapBals && preSwapBals.from !== fromBal && (
                  <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 line-through">
                    {preSwapBals.from}
                  </div>
                )}
              </div>

              {/* To token */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500 dark:text-slate-400">{details.toSym}</div>
                <div className={[
                  'mt-1 text-lg font-bold tabular-nums',
                  isDone ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100',
                ].join(' ')}>
                  {toBal}
                </div>
                {isDone && preSwapBals && preSwapBals.to !== toBal && (
                  <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 line-through">
                    {preSwapBals.to}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          {(isDone || isError) && (
            <button
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              onClick={onClose}
            >
              {isDone ? 'Close' : 'Dismiss'}
            </button>
          )}

          {isActive && (
            <div className="text-center text-xs text-slate-400 dark:text-slate-600">
              Alkebuleum transactions typically confirm in under 30 seconds.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
