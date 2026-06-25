// src/pages/Liquidity.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { logAmmEventsFromReceipt } from '../lib/ammEventLogger'
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore'
import { db } from '../services/firebase'

import { ethers } from 'ethers'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useSignerSession } from '../hooks/useSignerSession'
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
  erc20Iface,
} from '../lib/jollofAmm'
import { routerIface } from '../lib/jollofAmm'
import { ArrowDownUp } from 'lucide-react'
import { readHideBalances, readSlippageBps, writeSlippageBps, PREF } from '../lib/prefs'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { useConnectModalStore } from '../store/connectModalStore'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

const FACTORY = (import.meta.env.VITE_JOLLOF_FACTORY_ALK as string) ?? ''
const MIN_POOL_RESERVE_HUMAN = '0.01'

const STABLE_SYM = ((import.meta.env.VITE_USD_STABLE as string) ?? 'MAH').toUpperCase()
const STABLE_USD_PRICE = Number(import.meta.env.VITE_USD_STABLE_PRICE ?? 0.01)

function fmtUsd(v: number): string {
  if (!isFinite(v) || v < 0) return '—'
  if (v >= 1) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (v >= 0.0001) return v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  return v.toExponential(3)
}

function fmtRate(r: number): string {
  if (!isFinite(r) || r <= 0) return '—'
  if (r >= 1000) return r.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (r >= 1) return r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (r >= 0.0001) return r.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  return r.toExponential(4)
}

const FACTORY_ABI = ['function protocolTreasury() view returns (address)']
const ERC20_XFER_IFACE = new ethers.Interface(['function transfer(address to,uint256 value) returns (bool)'])
const PAIR_SYNC_IFACE = new ethers.Interface(['function sync()'])

function buildErc20TransferTx(tokenAddr: string, to: string, amount: bigint) {
  return { to: tokenAddr, data: ERC20_XFER_IFACE.encodeFunctionData('transfer', [to, amount]), value: 0n }
}

const TOKEN_COLORS_LIQ: Record<string, string> = {
  ALKE: 'linear-gradient(135deg,#8B5CF6,#a78bfa)',
  MAH:  'linear-gradient(135deg,#F7B53B,#e09c25)',
  JLF:  'linear-gradient(135deg,#FF5A3C,#ff7a4d)',
  USDC: 'linear-gradient(135deg,#2775CA,#4a93e8)',
  USDT: 'linear-gradient(135deg,#26A17B,#3fc497)',
  WAKE: 'linear-gradient(135deg,#8B5CF6,#c4b5fd)',
}
const TOKEN_GLYPHS_LIQ: Record<string, string> = {
  ALKE: 'A', MAH: 'M', JLF: 'J', USDC: '$', USDT: '₮', WAKE: 'W',
}
function tColor(s: string) { return TOKEN_COLORS_LIQ[s.toUpperCase()] || 'linear-gradient(135deg,var(--red),var(--gold))' }
function tGlyph(s: string) { return TOKEN_GLYPHS_LIQ[s.toUpperCase()] || s.slice(0, 1).toUpperCase() }

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

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
  const defaultGasPrice = 5_000_000_000n
  if (out.gasLimit == null && out.gas == null) out.gasLimit = defaultGasLimit
  if (typeof out.gasLimit === 'bigint') out.gasLimit = Number(out.gasLimit)
  if (out.gas == null) out.gas = out.gasLimit
  if (typeof out.gas === 'bigint') out.gas = Number(out.gas)
  out.gasPrice = hexValue(out.gasPrice ?? defaultGasPrice)
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
  return { to: pairAddr, data: i.encodeFunctionData('approve', [spender, amount]), value: 0n }
}

function buildRemoveLiquidityTx(args: {
  tokenA: any; tokenB: any; liquidity: bigint; amountAMin: bigint; amountBMin: bigint; recipient: string; deadlineSec: number
}) {
  const { tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, deadlineSec } = args
  const deadline = Math.floor(Date.now() / 1000) + deadlineSec
  const AisNative = !!tokenA.isNative
  const BisNative = !!tokenB.isNative
  if (AisNative && BisNative) throw new Error('Invalid pair: both tokens are native.')
  if (AisNative !== BisNative) {
    const erc20Side = AisNative ? tokenB : tokenA
    const tokenAddr = tokenAddressForPath(erc20Side)
    const amountTokenMin = AisNative ? amountBMin : amountAMin
    const amountETHMin = AisNative ? amountAMin : amountBMin
    return { to: ROUTER, data: routerTxIface2.encodeFunctionData('removeLiquidityETH', [tokenAddr, liquidity, amountTokenMin, amountETHMin, recipient, BigInt(deadline)]), value: 0n }
  }
  return { to: ROUTER, data: routerTxIface2.encodeFunctionData('removeLiquidity', [tokenAddressForPath(tokenA), tokenAddressForPath(tokenB), liquidity, amountAMin, amountBMin, recipient, BigInt(deadline)]), value: 0n }
}

function pickRevertData(err: any): string | null {
  const candidates = [err?.data, err?.error?.data, err?.info?.error?.data, err?.info?.error?.data?.data, err?.info?.error?.data?.result, err?.revert?.data, err?.error?.revert?.data]
  for (const c of candidates) { if (typeof c === 'string' && c.startsWith('0x')) return c }
  return null
}

function tryDecodeRevert(err: any): string {
  const data = pickRevertData(err)
  if (!data) return err?.shortMessage || err?.message || 'Reverted (no data)'
  try { const parsed = routerIface.parseError(data); if (parsed) return `RouterError: ${parsed.name}(${Array.from(parsed.args ?? []).map(String).join(', ')})` } catch { }
  try { if (data.slice(0, 10) === '0x08c379a0') return `Error: ${ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + data.slice(10))[0]}` } catch { }
  try { if (data.slice(0, 10) === '0x4e487b71') return `Panic: ${ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + data.slice(10))[0].toString()}` } catch { }
  return `Reverted (data=${data.slice(0, 18)}…)`
}

async function getRevertReasonFromChain(provider: ethers.JsonRpcProvider, txHash: string): Promise<string | null> {
  const tx = await provider.getTransaction(txHash)
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!tx || !receipt || receipt.status === 1) return null
  try { await provider.call({ to: tx.to ?? undefined, from: tx.from, data: tx.data, value: tx.value ?? 0n, blockTag: receipt.blockNumber }); return null } catch (e: any) { return tryDecodeRevert(e) }
}

export default function Liquidity() {
  const { isConnected: walletConnected, address } = useWalletConnection()
  const { ain, ainLoading, aaWallet } = useWalletMetaStore()

  // If user has an AA wallet, LP tokens go there and positions are read from there.
  // If no AA wallet (plain EOA), use the signer address directly.
  const accountAddress = (aaWallet && ethers.isAddress(aaWallet)) ? aaWallet : (address ?? '')
  const hasDistinctSigner = !!aaWallet && !!address && aaWallet.toLowerCase() !== address.toLowerCase()
  const { sessionSendTransactions } = useSignerSession()
  const openConnectModal = useConnectModalStore(s => s.openModal)

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
  const firstAddTimeRef = useRef<number | null>(null)

  const [lastEdited, setLastEdited] = useState<'A' | 'B'>('A')
  const [rawReserveA, setRawReserveA] = useState<bigint>(0n)
  const [rawReserveB, setRawReserveB] = useState<bigint>(0n)
  const [decAState, setDecAState] = useState<number>(18)
  const [decBState, setDecBState] = useState<number>(18)
  const [poolHasReserves, setPoolHasReserves] = useState(false)

  const [poolDetailsOpen, setPoolDetailsOpen] = useState(false)
  const [lpTotalSupplyUi, setLpTotalSupplyUi] = useState<string>('—')
  const [lpBalRaw, setLpBalRaw] = useState<bigint>(0n)
  const [lpSupplyRaw, setLpSupplyRaw] = useState<bigint>(0n)

  const [feesPnlUi, setFeesPnlUi] = useState<string>('—')
  const [feesPnlNote, setFeesPnlNote] = useState<string | null>(null)

  const [, setRatioAtoB] = useState<string>('—')
  const [ratioBtoA, setRatioBtoA] = useState<string>('—')

  const [slippageBps, setSlippageBps] = useState<number>(() => readSlippageBps(50))
  const [hideBalances, setHideBalances] = useState<boolean>(() => readHideBalances())

  const [sp] = useSearchParams()
  const location = useLocation()
  const didInitRouteRef = useRef(false)

  const [isAdmin, setIsAdmin] = useState(false)
  const [lpGate, setLpGate] = useState<{ blocked: boolean; reason: string | null }>({ blocked: false, reason: null })
  const [repairA, setRepairA] = useState('')
  const [repairB, setRepairB] = useState('')

  // UI state
  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add')
  const [tokenModalFor, setTokenModalFor] = useState<'A' | 'B' | null>(null)
  const [tokenSearch, setTokenSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const tokenOptions = enabled

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
    if (nextA === nextB) nextB = ((enabled as string[]).find((x) => x !== nextA) as TokenKey) ?? nextB
    setTokenA(nextA)
    setTokenB(nextB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!address || !FACTORY || !ethers.isAddress(FACTORY)) { if (alive) setIsAdmin(false); return }
        const f = new ethers.Contract(FACTORY, FACTORY_ABI, provider)
        const treasury: string = await f.protocolTreasury()
        const admin = (treasury && treasury !== ethers.ZeroAddress) ? treasury : FACTORY
        if (alive) setIsAdmin(admin.toLowerCase() === address.toLowerCase())
      } catch { if (alive) setIsAdmin(false) }
    })()
    return () => { alive = false }
  }, [address, provider])

  useEffect(() => { writeSlippageBps(slippageBps) }, [slippageBps])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREF.HIDE_BALANCES) setHideBalances(readHideBalances())
      if (e.key === PREF.SLIPPAGE_BPS) setSlippageBps(readSlippageBps(50))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const [balA, setBalA] = useState('—')
  const [balANum, setBalANum] = useState<number>(0)
  const [balB, setBalB] = useState('—')
  const [balBNum, setBalBNum] = useState<number>(0)
  const [loadingBalances, setLoadingBalances] = useState(false)

  const [pairAddr, setPairAddr] = useState<string>('—')
  const [lpBalUi, setLpBalUi] = useState<string>('—')
  const [lpShareUi, setLpShareUi] = useState<string>('—')

  const [reserveAUi, setReserveAUi] = useState<string>('—')
  const [reserveBUi, setReserveBUi] = useState<string>('—')
  const [underAUi, setUnderAUi] = useState<string>('—')
  const [underBUi, setUnderBUi] = useState<string>('—')

  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [addLiqDialogOpen, setAddLiqDialogOpen] = useState(false)
  const [addLiqDialogPhase, setAddLiqDialogPhase] = useState<'confirming' | 'success' | 'error'>('confirming')
  const [addLiqDialogErr, setAddLiqDialogErr] = useState<string | null>(null)
  const [addLiqDialogDetails, setAddLiqDialogDetails] = useState<{ symA: string; symB: string; amtA: string; amtB: string; txHash: string } | null>(null)
  const [preAddBals, setPreAddBals] = useState<{ a: string; b: string } | null>(null)
  const [removePct, setRemovePct] = useState(100)

  // Signer reconcile — only populated when aaWallet exists and signer holds LP separately
  const [signerLpBalRaw, setSignerLpBalRaw] = useState<bigint>(0n)
  const [signerUnderAUi, setSignerUnderAUi] = useState<string>('—')
  const [signerUnderBUi, setSignerUnderBUi] = useState<string>('—')
  const [reconcileBusy, setReconcileBusy] = useState(false)

  const REMOVE_PREFLIGHT = { flow: 'remove_liquidity_v1', gasTopup: { enabled: true, purpose: 'jswap-remove-liquidity' } } as any
  const LIQ_PREFLIGHT = { flow: 'liquidity_v1', gasTopup: { enabled: true, purpose: 'jswap-liquidity' } } as any

  async function refreshBalances() {
    if (!address) { setBalA('—'); setBalANum(0); setBalB('—'); setBalBNum(0); return }
    const [b1, b2] = await Promise.all([getBalance(address, TOKENS[tokenA], provider), getBalance(address, TOKENS[tokenB], provider)])
    const [d1, d2] = await Promise.all([readDecimals(TOKENS[tokenA], provider), readDecimals(TOKENS[tokenB], provider)])
    const rawA = ethers.formatUnits(b1, d1)
    const rawB = ethers.formatUnits(b2, d2)
    setBalA(fmtNum(rawA)); setBalANum(Number(rawA))
    setBalB(fmtNum(rawB)); setBalBNum(Number(rawB))
  }

  function fmtLp(balance: bigint) {
    const raw = balance.toString()
    const ui = ethers.formatUnits(balance, 18)
    const n = Number(ui)
    if (!isFinite(n) || n === 0 || Math.abs(n) < 0.000001) return `${raw} (raw)`
    return fmtNum(ui)
  }

  async function refreshPositionAndReserves() {
    const req = ++posReqRef.current
    const isLive = () => req === posReqRef.current
    setPairAddr('—'); setLpBalUi('—'); setLpShareUi('—'); setLpBalRaw(0n); setLpSupplyRaw(0n)
    setReserveAUi('—'); setReserveBUi('—'); setUnderAUi('—'); setUnderBUi('—')
    setRawReserveA(0n); setRawReserveB(0n); setPoolHasReserves(false); setRatioAtoB('—'); setRatioBtoA('—')
    if (!accountAddress || tokenA === tokenB) return
    const A = TOKENS[tokenA]; const B = TOKENS[tokenB]
    // Reset signer reconcile state
    setSignerLpBalRaw(0n); setSignerUnderAUi('—'); setSignerUnderBUi('—')
    try {
      // Read account position (AA wallet if available, else signer)
      const [pos, signerPos] = await Promise.all([
        getLpPosition({ owner: accountAddress, tokenA: A, tokenB: B }),
        hasDistinctSigner && address ? getLpPosition({ owner: address, tokenA: A, tokenB: B }) : Promise.resolve(null),
      ])
      if (!isLive()) return
      const pair = pos.pair && pos.pair !== ethers.ZeroAddress ? pos.pair : ''
      setPairAddr(pair || '—'); setLpBalRaw(pos.lpBalance); setLpSupplyRaw(pos.totalSupply)
      setLpBalUi(fmtLp(pos.lpBalance)); setLpTotalSupplyUi(fmtLp(pos.totalSupply))
      if (pos.totalSupply > 0n && pos.lpBalance > 0n) {
        setLpShareUi(`${(Number((pos.lpBalance * 10000n) / pos.totalSupply) / 100).toFixed(2)}%`)
      } else setLpShareUi('—')
      if (!pair) return
      const pairC = new ethers.Contract(pair, PAIR_ABI, provider)
      const [t0, t1, reserves] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()])
      if (!isLive()) return
      const r0 = reserves[0] as bigint; const r1 = reserves[1] as bigint
      const addrA = tokenAddressForPath(A).toLowerCase(); const addrB = tokenAddressForPath(B).toLowerCase()
      const token0 = (t0 as string).toLowerCase(); const token1 = (t1 as string).toLowerCase()
      let reserveA = 0n; let reserveB = 0n
      if (addrA === token0 && addrB === token1) { reserveA = r0; reserveB = r1 }
      else if (addrA === token1 && addrB === token0) { reserveA = r1; reserveB = r0 }
      else { reserveA = r0; reserveB = r1 }
      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      if (!isLive()) return
      setReserveAUi(fmtNum(ethers.formatUnits(reserveA, decA)))
      setReserveBUi(fmtNum(ethers.formatUnits(reserveB, decB)))
      setRawReserveA(reserveA); setRawReserveB(reserveB); setDecAState(decA); setDecBState(decB)
      if (pair && pos.totalSupply > 0n) {
        const minA = ethers.parseUnits(MIN_POOL_RESERVE_HUMAN, decA); const minB = ethers.parseUnits(MIN_POOL_RESERVE_HUMAN, decB)
        setLpGate(reserveA < minA || reserveB < minB ? { blocked: true, reason: 'Pool is in repair mode (very low / imbalanced reserves). Adding liquidity is disabled to protect users.' } : { blocked: false, reason: null })
      } else setLpGate({ blocked: false, reason: null })
      const has = reserveA > 0n && reserveB > 0n; setPoolHasReserves(has)
      if (has) {
        const oneA = ethers.parseUnits('1', decA); const oneB = ethers.parseUnits('1', decB)
        setRatioAtoB(fmtNum(ethers.formatUnits(quote(oneA, reserveA, reserveB), decB)))
        setRatioBtoA(fmtNum(ethers.formatUnits(quote(oneB, reserveB, reserveA), decA)))
      } else { setRatioAtoB('—'); setRatioBtoA('—') }
      if (pos.totalSupply > 0n && pos.lpBalance > 0n && has) {
        setUnderAUi(fmtNum(ethers.formatUnits((reserveA * pos.lpBalance) / pos.totalSupply, decA)))
        setUnderBUi(fmtNum(ethers.formatUnits((reserveB * pos.lpBalance) / pos.totalSupply, decB)))
      } else { setUnderAUi('—'); setUnderBUi('—') }
      // Signer reconcile: populate if signer holds separate LP tokens
      if (signerPos && signerPos.lpBalance > 0n && has) {
        setSignerLpBalRaw(signerPos.lpBalance)
        setSignerUnderAUi(fmtNum(ethers.formatUnits((reserveA * signerPos.lpBalance) / pos.totalSupply, decA)))
        setSignerUnderBUi(fmtNum(ethers.formatUnits((reserveB * signerPos.lpBalance) / pos.totalSupply, decB)))
      }
    } catch { /* keep cleared UI */ }
  }

  useEffect(() => { didUserEditRef.current = false; setLastEdited('A') }, [tokenA, tokenB])
  useEffect(() => {
    if (!poolHasReserves) return
    if (didUserEditRef.current) return
    if (lastEdited === 'A') syncBFromA(amtA); else syncAFromB(amtB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolHasReserves, rawReserveA, rawReserveB, decAState, decBState])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoadingBalances(true)
      try { if (!alive) return; await refreshBalances() } catch (e: any) { if (!alive) return } finally { if (!alive) return; setLoadingBalances(false) }
    })()
    const id = window.setInterval(() => { if (!alive) return; refreshBalances().catch(() => {}) }, 12000)
    return () => { alive = false; window.clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, tokenA, tokenB])

  useEffect(() => {
    let alive = true
    ;(async () => { try { if (!alive) return; await refreshPositionAndReserves() } catch { if (!alive) return } })()
    const id = window.setInterval(() => { if (!alive) return; refreshPositionAndReserves().catch(() => {}) }, 12000)
    return () => { alive = false; window.clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountAddress, address, tokenA, tokenB])


  // Fees / P&L
  useEffect(() => {
    if (!address || !pairAddr || pairAddr === '—') { setFeesPnlUi('—'); setFeesPnlNote(null); return }
    const D = 1_000_000n; const LP_FEE_PPM = 2_500n
    const bn = (x: any) => { try { return BigInt(x ?? 0) } catch { return 0n } }
    const lower = (x: any) => String(x ?? '').toLowerCase()
    const aAddr = tokenAddressForPath(TOKENS[tokenA]).toLowerCase(); const bAddr = tokenAddressForPath(TOKENS[tokenB]).toLowerCase()
    const pairKey = `${ALK_CHAIN_ID}_${pairAddr.toLowerCase()}`; const userKey = address.toLowerCase()
    const map01toAB = (token0: string, token1: string, v0: bigint, v1: bigint) => {
      const t0 = lower(token0); const t1 = lower(token1); const a = lower(aAddr); const b = lower(bAddr)
      if (a === t0 && b === t1) return { a: v0, b: v1 }; if (a === t1 && b === t0) return { a: v1, b: v0 }; return { a: v0, b: v1 }
    }
    const qUser = query(collection(db, 'amm_events'), where('pairKey', '==', pairKey), where('user', '==', userKey), orderBy('blockTime', 'asc'), limit(1500))
    const unsubUser = onSnapshot(qUser, (snap) => {
      const byTx = new Map<string, any[]>()
      snap.forEach((d) => { const x: any = d.data(); const tx = String(x.txHash || ''); if (!tx) return; const arr = byTx.get(tx) ?? []; arr.push(x); byTx.set(tx, arr) })
      let depValueA = 0n; let wdrValueA = 0n; let firstAddTime: number | null = null
      for (const rows of byTx.values()) {
        const sync = rows.find((r) => r?.event === 'Sync')
        const mint = rows.find((r) => r?.event === 'Mint' && r?.action === 'add_liquidity')
        const burn = rows.find((r) => r?.event === 'Burn' && r?.action === 'remove_liquidity')
        let rA = 0n; let rB = 0n
        if (sync?.args?.reserve0 != null && sync?.args?.reserve1 != null) { const mapped = map01toAB(sync.token0, sync.token1, bn(sync.args.reserve0), bn(sync.args.reserve1)); rA = mapped.a; rB = mapped.b }
        const bToA = (bRaw: bigint) => { if (rA === 0n || rB === 0n) return 0n; return quote(bRaw, rB, rA) }
        if (mint?.args?.amount0 != null && mint?.args?.amount1 != null) {
          if (!firstAddTime && typeof mint.blockTime === 'number') firstAddTime = mint.blockTime
          const mapped = map01toAB(mint.token0, mint.token1, bn(mint.args.amount0), bn(mint.args.amount1)); depValueA += mapped.a + bToA(mapped.b)
        }
        if (burn?.args?.amount0 != null && burn?.args?.amount1 != null) { const mapped = map01toAB(burn.token0, burn.token1, bn(burn.args.amount0), bn(burn.args.amount1)); wdrValueA += mapped.a + bToA(mapped.b) }
      }
      let curValueA = 0n
      if (rawReserveA > 0n && rawReserveB > 0n && lpSupplyRaw > 0n && lpBalRaw > 0n) { const curA = (rawReserveA * lpBalRaw) / lpSupplyRaw; const curB = (rawReserveB * lpBalRaw) / lpSupplyRaw; curValueA = curA + quote(curB, rawReserveB, rawReserveA) }
      const pnlA = (curValueA + wdrValueA) - depValueA
      firstAddTimeRef.current = firstAddTime
      setFeesPnlUi(`P&L: ${pnlA >= 0n ? '+' : ''}${fmtNum(ethers.formatUnits(pnlA, decAState))} ${tokenA} • Fees: …`)
      setFeesPnlNote('Fees are estimated (uses current LP share). Exact fees require LP share over time.')
    }, (err) => console.error('[Liquidity] P&L user snapshot error:', err))
    const qSwaps = query(collection(db, 'amm_events'), where('pairKey', '==', pairKey), where('event', '==', 'Swap'), orderBy('blockTime', 'asc'), limit(2000))
    const unsubSwaps = onSnapshot(qSwaps, (snap) => {
      const firstAddTime = firstAddTimeRef.current; if (!firstAddTime) return
      if (lpSupplyRaw <= 0n || lpBalRaw <= 0n) { setFeesPnlUi((prev) => prev.replace(/Fees: .*/, `Fees: 0 ${tokenA} (est)`)); return }
      const sharePpm = (lpBalRaw * 1_000_000n) / lpSupplyRaw; let totalFeeA = 0n; let totalFeeB = 0n
      snap.forEach((d) => {
        const x: any = d.data(); if (!x?.blockTime || x.blockTime < firstAddTime) return
        const fee0 = (bn(x?.args?.amount0In) * LP_FEE_PPM) / D; const fee1 = (bn(x?.args?.amount1In) * LP_FEE_PPM) / D
        const mapped = map01toAB(x.token0, x.token1, fee0, fee1); totalFeeA += mapped.a; totalFeeB += mapped.b
        function bn(x: any) { try { return BigInt(x ?? 0) } catch { return 0n } }
      })
      let feesValueA = 0n
      if (rawReserveA > 0n && rawReserveB > 0n) feesValueA = totalFeeA + quote(totalFeeB, rawReserveB, rawReserveA)
      const userFeesA = (feesValueA * sharePpm) / 1_000_000n
      setFeesPnlUi((prev) => prev.replace(/Fees: .*/, `Fees: +${fmtNum(ethers.formatUnits(userFeesA, decAState))} ${tokenA} (est)`))
    }, (err) => console.error('[Liquidity] P&L swaps snapshot error:', err))
    return () => { unsubUser(); unsubSwaps() }
  }, [address, pairAddr, tokenA, tokenB, rawReserveA, rawReserveB, decAState, lpBalRaw, lpSupplyRaw])

  async function onAddLiquidity() {
    setErr(null); setAddLiqDialogErr(null); setAddLiqDialogDetails(null); setBusy(true)
    let dialogOpened = false
    try {
      if (!walletConnected || !address) throw new Error('Connect your wallet using the top bar to continue.')
      if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')
      if (tokenA === tokenB) throw new Error('Select different tokens.')
      if (lpGate.blocked && !isAdmin) throw new Error(lpGate.reason ?? 'Pool needs admin repair before adding liquidity.')
      const aStr = clampAmountStr(amtA.trim()); const bStr = clampAmountStr(amtB.trim())
      if (!aStr || Number(aStr) <= 0) throw new Error('Enter a valid Amount A.')
      if (!bStr || Number(bStr) <= 0) throw new Error('Enter a valid Amount B.')
      if (balANum > 0 && Number(aStr) > balANum) throw new Error(`Insufficient ${tokenA} balance. You have ${balA} ${tokenA}.`)
      if (balBNum > 0 && Number(bStr) > balBNum) throw new Error(`Insufficient ${tokenB} balance. You have ${balB} ${tokenB}.`)
      const A = TOKENS[tokenA]; const B = TOKENS[tokenB]
      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      const amountA = ethers.parseUnits(aStr, decA); const amountB = ethers.parseUnits(bStr, decB)
      const plan = await planAddLiquidity({ tokenA: A, tokenB: B, amountADesired: amountA, amountBDesired: amountB, slippageBps, provider })
      const usedA = plan.usedA; const usedB = plan.usedB; const minA = plan.minA; const minB = plan.minB
      const usedAUi = fmtNum(ethers.formatUnits(usedA, decA)); const usedBUi = fmtNum(ethers.formatUnits(usedB, decB))
      const txs: any[] = []

      // ── Auto-deposit: top up AA wallet from signer if needed ──────────────
      // Only when AA wallet and signer are distinct addresses.
      if (hasDistinctSigner && accountAddress && address) {
        for (const [tok, needed, dec] of [[A, usedA, decA], [B, usedB, decB]] as const) {
          if ((tok as any).isNative) {
            // Native ALKE: check AA wallet balance, top up from signer if short
            const aaBal = await provider.getBalance(accountAddress)
            if (aaBal < needed) {
              const shortfall = needed - aaBal
              const signerBal = await provider.getBalance(address)
              const kMinGasWei = ethers.parseEther('0.5') // keep 0.5 ALKE on signer for gas
              const transferable = signerBal > kMinGasWei ? signerBal - kMinGasWei : 0n
              if (aaBal + transferable < needed) throw new Error(
                `Insufficient ${(tok as any).symbol}. Need ${fmtNum(ethers.formatUnits(needed, dec as number))}, ` +
                `account has ${fmtNum(ethers.formatUnits(aaBal, dec as number))}, ` +
                `Account Key has ${fmtNum(ethers.formatUnits(transferable, dec as number))} (after gas reserve).`
              )
              setInfo(`Topping up account with ${fmtNum(ethers.formatUnits(shortfall, dec as number))} ${(tok as any).symbol} from Account Key…`)
              txs.push({ to: accountAddress, value: shortfall, data: '0x' })
            }
          } else {
            // ERC20: check AA wallet balance, transfer shortfall from signer
            const aaBal: bigint = await getBalance(accountAddress, tok as any, provider)
            if (aaBal < needed) {
              const shortfall = needed - aaBal
              const signerBal: bigint = await getBalance(address, tok as any, provider)
              if (signerBal < shortfall) throw new Error(
                `Insufficient ${(tok as any).symbol}. Need ${fmtNum(ethers.formatUnits(needed, dec as number))}, ` +
                `account has ${fmtNum(ethers.formatUnits(aaBal, dec as number))}, ` +
                `Account Key has ${fmtNum(ethers.formatUnits(signerBal, dec as number))}.`
              )
              setInfo(`Topping up account with ${fmtNum(ethers.formatUnits(shortfall, dec as number))} ${(tok as any).symbol} from Account Key…`)
              const transferData = erc20Iface.encodeFunctionData('transfer', [accountAddress, shortfall])
              txs.push({ to: (tok as any).address, data: transferData, value: 0n })
            }
          }
        }
      }

      if (!A.isNative) { const allowanceA = await getAllowance(accountAddress, A, ROUTER, provider); if (allowanceA < usedA) { const approveTx = buildApproveTx(A, ROUTER, usedA); if (approveTx) txs.push(approveTx) } }
      if (!B.isNative) { const allowanceB = await getAllowance(accountAddress, B, ROUTER, provider); if (allowanceB < usedB) { const approveTx = buildApproveTx(B, ROUTER, usedB); if (approveTx) txs.push(approveTx) } }
      txs.push(buildAddLiquidityTx({ tokenA: A, tokenB: B, amountA, amountB, amountAMin: minA, amountBMin: minB, recipient: accountAddress, deadlineSec: 10 * 60, valueNative: plan.nativeValue > 0n ? plan.nativeValue : undefined }))
      const safeTxs = txs.map(normalizeTx)
      setPreAddBals({ a: balA, b: balB })
      const results = await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: safeTxs, failFast: true, preflight: LIQ_PREFLIGHT } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'add_liquidity')
      const firstFail = results?.find((r: any) => r?.ok === false); if (firstFail) throw new Error(firstFail.error || 'Transaction failed')
      const hashes: string[] = (results || []).map((r: any) => r?.txHash as string | undefined).filter(Boolean) as string[]
      const addLiqHash = hashes[hashes.length - 1]
      setAddLiqDialogDetails({ symA: tokenA, symB: tokenB, amtA: usedAUi, amtB: usedBUi, txHash: addLiqHash })
      setAddLiqDialogPhase('confirming'); setAddLiqDialogOpen(true); dialogOpened = true
      const labels: string[] = safeTxs.map((t: any, i: number) => { const isRouter = (t?.to || '').toLowerCase() === ROUTER.toLowerCase(); return isRouter ? 'addLiquidity' : `approve #${i + 1}` })
      let anyFail = false; let lastReason: string | null = null
      for (let i = 0; i < hashes.length; i++) {
        const h = hashes[i]; const r = await waitForReceipt(provider, h)
        if (!r) { anyFail = true } else if (r.status === 1) {
          if (labels[i] === 'addLiquidity') await logAmmEventsFromReceipt({ provider, chainId: ALK_CHAIN_ID, receipt: r, action: 'add_liquidity', user: address, ain: ainLoading ? null : (ain ?? null), tokenA, tokenB, pairHint: pairAddr !== '—' ? pairAddr : null })
        } else {
          anyFail = true
          let reason = await getRevertReasonFromChain(provider, h)
          if (!reason) { const txObj = await provider.getTransaction(h); if (txObj?.gasLimit && r.gasUsed >= txObj.gasLimit - 1000n) reason = 'Out of gas (gasUsed≈gasLimit). Increase gasLimit.' }
          lastReason = reason ?? 'reverted (no reason decoded)'
        }
      }
      if (anyFail) { setAddLiqDialogPhase('error'); setAddLiqDialogErr(lastReason ? `addLiquidity reverted: ${lastReason}` : 'One or more transactions reverted or did not confirm.') } else setAddLiqDialogPhase('success')
      await refreshBalances(); await refreshPositionAndReserves()
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Add Liquidity failed.'
      if (dialogOpened) { setAddLiqDialogErr(msg); setAddLiqDialogPhase('error') } else setErr(msg)
    } finally { setBusy(false) }
  }

  async function onRemoveLiquidity() {
    setErr(null); setInfo(null); setBusy(true)
    try {
      if (!walletConnected || !address) throw new Error('Connect your wallet using the top bar to continue.')
      if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')
      if (tokenA === tokenB) throw new Error('Select different tokens.')
      if (!pairAddr || pairAddr === '—') throw new Error('No pair found for this token selection.')
      if (removePct <= 0) throw new Error('Pick a remove percentage.')
      const A = TOKENS[tokenA]; const B = TOKENS[tokenB]
      const pos = await getLpPosition({ owner: accountAddress, tokenA: A, tokenB: B })
      const pair = pos.pair && pos.pair !== ethers.ZeroAddress ? pos.pair : ''
      if (!pair) throw new Error('No pool exists yet for this pair.')
      if (pos.lpBalance <= 0n) throw new Error('You have no LP tokens for this pool.')
      const pctBps = BigInt(Math.max(0, Math.min(100, removePct)) * 100)
      const lpToRemove = (pos.lpBalance * pctBps) / 10_000n
      if (lpToRemove <= 0n) throw new Error('Remove amount too small.')
      const pairC = new ethers.Contract(pair, PAIR_ABI, provider)
      const [t0, t1, reserves] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()])
      const r0 = reserves[0] as bigint; const r1 = reserves[1] as bigint
      const addrA = tokenAddressForPath(A).toLowerCase(); const addrB = tokenAddressForPath(B).toLowerCase()
      const token0 = (t0 as string).toLowerCase(); const token1 = (t1 as string).toLowerCase()
      let reserveA = 0n; let reserveB = 0n
      if (addrA === token0 && addrB === token1) { reserveA = r0; reserveB = r1 } else if (addrA === token1 && addrB === token0) { reserveA = r1; reserveB = r0 } else { reserveA = r0; reserveB = r1 }
      if (pos.totalSupply <= 0n) throw new Error('Pool totalSupply is zero (unexpected).')
      const outA = (reserveA * lpToRemove) / pos.totalSupply; const outB = (reserveB * lpToRemove) / pos.totalSupply
      const minA = applySlippage(outA, slippageBps); const minB = applySlippage(outB, slippageBps)
      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      setInfo(`Removing ${removePct}%: ~${fmtNum(ethers.formatUnits(outA, decA))} ${tokenA} + ~${fmtNum(ethers.formatUnits(outB, decB))} ${tokenB}. Confirm in your wallet…`)
      const txs: any[] = []
      const lpC = new ethers.Contract(pair, ERC20_ABI, provider)
      const lpAllowance: bigint = await lpC.allowance(accountAddress, ROUTER)
      if (lpAllowance < lpToRemove) txs.push(buildLpApproveTx(pair, ROUTER, lpToRemove))
      txs.push(buildRemoveLiquidityTx({ tokenA: A, tokenB: B, liquidity: lpToRemove, amountAMin: minA, amountBMin: minB, recipient: accountAddress, deadlineSec: 10 * 60 }))
      const safeTxs = txs.map(normalizeTx)
      const results = await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: safeTxs, failFast: true, preflight: REMOVE_PREFLIGHT } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'remove_liquidity')
      const firstFail = results?.find((r: any) => r?.ok === false); if (firstFail) throw new Error(firstFail.error || 'Transaction failed')
      const hashes: string[] = (results || []).map((r: any) => r?.txHash).filter(Boolean) as string[]
      const labels = safeTxs.map((t: any) => { const toAddr = (t?.to || '').toLowerCase(); if (toAddr === pair.toLowerCase()) return 'approve LP'; if (toAddr === ROUTER.toLowerCase()) return 'removeLiquidity'; return 'tx' })
      setInfo('Waiting for on-chain confirmation…')
      let anyFail = false; let lastReason: string | null = null
      for (let i = 0; i < hashes.length; i++) {
        const h = hashes[i]; const r = await waitForReceipt(provider, h)
        if (!r) { anyFail = true } else if (r.status === 1) {
          if (labels[i] === 'removeLiquidity') await logAmmEventsFromReceipt({ provider, chainId: ALK_CHAIN_ID, receipt: r, action: 'remove_liquidity', user: address, ain: ainLoading ? null : (ain ?? null), tokenA, tokenB, pairHint: pairAddr !== '—' ? pairAddr : null })
        } else {
          anyFail = true
          let reason = await getRevertReasonFromChain(provider, h)
          if (!reason) { const txObj = await provider.getTransaction(h); if (txObj?.gasLimit && r.gasUsed >= txObj.gasLimit - 1000n) reason = 'Out of gas (gasUsed≈gasLimit). Increase gasLimit.' }
          lastReason = reason ?? 'reverted (no reason decoded)'
        }
      }
      if (anyFail) { setErr(lastReason ? `removeLiquidity reverted: ${lastReason}` : 'One or more transactions reverted or did not confirm.'); setInfo(null) } else setInfo('Liquidity removed ✅')
      await refreshBalances(); await refreshPositionAndReserves()
    } catch (e: any) { setErr(e?.shortMessage || e?.message || 'Remove Liquidity failed.'); setInfo(null) } finally { setBusy(false) }
  }

  async function onReconcileSigner() {
    if (!address || !pairAddr || pairAddr === '—' || signerLpBalRaw <= 0n || lpSupplyRaw <= 0n) return
    setErr(null); setInfo(null); setReconcileBusy(true)
    try {
      const A = TOKENS[tokenA]; const B = TOKENS[tokenB]
      const pairC = new ethers.Contract(pairAddr, PAIR_ABI, provider)
      const [t0, , reserves] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()])
      const r0 = reserves[0] as bigint; const r1 = reserves[1] as bigint
      const addrA = tokenAddressForPath(A).toLowerCase()
      let reserveA = 0n; let reserveB = 0n
      if (addrA === (t0 as string).toLowerCase()) { reserveA = r0; reserveB = r1 } else { reserveA = r1; reserveB = r0 }
      const outA = (reserveA * signerLpBalRaw) / lpSupplyRaw
      const outB = (reserveB * signerLpBalRaw) / lpSupplyRaw
      const minA = applySlippage(outA, slippageBps); const minB = applySlippage(outB, slippageBps)
      const lpC = new ethers.Contract(pairAddr, ERC20_ABI, provider)
      const lpAllowance: bigint = await lpC.allowance(address, ROUTER)
      const txs: any[] = []
      if (lpAllowance < signerLpBalRaw) txs.push(buildLpApproveTx(pairAddr, ROUTER, signerLpBalRaw))
      // Recipient = accountAddress so tokens land in the AA wallet
      txs.push(buildRemoveLiquidityTx({ tokenA: A, tokenB: B, liquidity: signerLpBalRaw, amountAMin: minA, amountBMin: minB, recipient: accountAddress, deadlineSec: 10 * 60 }))
      setInfo('Reconciling — confirm in your wallet…')
      await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: txs.map(normalizeTx), failFast: true, preflight: REMOVE_PREFLIGHT } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'reconcile_signer')
      setInfo('Reconciled! Signer position moved to your account.')
      setSignerLpBalRaw(0n); setSignerUnderAUi('—'); setSignerUnderBUi('—')
      await refreshPositionAndReserves()
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? String(e))
    } finally {
      setReconcileBusy(false)
    }
  }

  async function onRepairPool() {
    setErr(null); setInfo(null); setBusy(true)
    try {
      if (!walletConnected || !address) throw new Error('Connect your wallet to continue.')
      if (!isAdmin) throw new Error('Admin only.')
      if (!pairAddr || pairAddr === '—') throw new Error('No pair found.')
      const A = TOKENS[tokenA]; const B = TOKENS[tokenB]
      const [decA, decB] = await Promise.all([readDecimals(A, provider), readDecimals(B, provider)])
      const aStr = clampAmountStr(repairA.trim()); const bStr = clampAmountStr(repairB.trim())
      const donateA = aStr ? ethers.parseUnits(aStr, decA) : 0n; const donateB = bStr ? ethers.parseUnits(bStr, decB) : 0n
      if (donateA <= 0n && donateB <= 0n) throw new Error('Enter a donate amount.')
      const addrA = tokenAddressForPath(A); const addrB = tokenAddressForPath(B)
      const txs: any[] = []
      if (donateA > 0n) txs.push(buildErc20TransferTx(addrA, pairAddr, donateA))
      if (donateB > 0n) txs.push(buildErc20TransferTx(addrB, pairAddr, donateB))
      txs.push({ to: pairAddr, data: PAIR_SYNC_IFACE.encodeFunctionData('sync', []), value: 0n })
      const safeTxs = txs.map(normalizeTx)
      setInfo('Repair queued. Confirm in your wallet…')
      const results = await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: safeTxs, failFast: true, preflight: { flow: 'repair_pool_v1' } } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'repair_pool')
      const firstFail = results?.find((r: any) => r?.ok === false); if (firstFail) throw new Error(firstFail.error || 'Transaction failed')
      const hashes: string[] = (results || []).map((r: any) => r?.txHash).filter(Boolean)
      setInfo('Waiting for confirmation…')
      const syncHash = hashes[hashes.length - 1]
      const receipt = await waitForReceipt(provider, syncHash)
      if (receipt && receipt.status === 1) await logAmmEventsFromReceipt({ provider, chainId: ALK_CHAIN_ID, receipt, action: 'admin_repair', user: address, ain: ainLoading ? null : (ain ?? null), tokenA, tokenB, pairHint: pairAddr })
      setInfo('Pool repaired ✅ (donation + sync)')
      await refreshPositionAndReserves()
    } catch (e: any) { setErr(e?.shortMessage || e?.message || 'Repair failed.'); setInfo(null) } finally { setBusy(false) }
  }

  function trim6(s: string) { if (!s.includes('.')) return s; const [a, b] = s.split('.'); return `${a}.${(b || '').slice(0, 6)}` }

  function syncBFromA(aStr: string) {
    if (!poolHasReserves || rawReserveA === 0n || rawReserveB === 0n) return
    const v = clampAmountStr(aStr); if (!v || Number(v) <= 0) return setAmtB('')
    try { const aIn = ethers.parseUnits(v, decAState); const bOut = quote(aIn, rawReserveA, rawReserveB); setAmtB(trim6(ethers.formatUnits(bOut, decBState))) } catch { }
  }

  function syncAFromB(bStr: string) {
    if (!poolHasReserves || rawReserveA === 0n || rawReserveB === 0n) return
    const v = clampAmountStr(bStr); if (!v || Number(v) <= 0) return setAmtA('')
    try { const bIn = ethers.parseUnits(v, decBState); const aOut = quote(bIn, rawReserveB, rawReserveA); setAmtA(trim6(ethers.formatUnits(aOut, decAState))) } catch { }
  }

  const balADisplay = hideBalances ? '•••' : (loadingBalances ? '…' : balA)
  const balBDisplay = hideBalances ? '•••' : (loadingBalances ? '…' : balB)

  const amtANum = Number(clampAmountStr(amtA.trim())) || 0
  const amtBNum = Number(clampAmountStr(amtB.trim())) || 0

  const ratioAtoBNum: number | null = (() => {
    if (!poolHasReserves || rawReserveA === 0n || rawReserveB === 0n) return null
    try { const oneA = ethers.parseUnits('1', decAState); const outB = quote(oneA, rawReserveA, rawReserveB); return Number(ethers.formatUnits(outB, decBState)) } catch { return null }
  })()

  const nonStableSym = tokenA.toUpperCase() === STABLE_SYM ? tokenB : tokenA
  const altUsdPerToken: number | null =
    tokenA.toUpperCase() === STABLE_SYM && ratioAtoBNum !== null && ratioAtoBNum > 0 ? STABLE_USD_PRICE / ratioAtoBNum
      : tokenB.toUpperCase() === STABLE_SYM && ratioAtoBNum !== null && ratioAtoBNum > 0 ? ratioAtoBNum * STABLE_USD_PRICE : null

  const usdA: number | null =
    tokenA.toUpperCase() === STABLE_SYM && amtANum > 0 ? amtANum * STABLE_USD_PRICE
      : tokenB.toUpperCase() === STABLE_SYM && altUsdPerToken !== null && amtANum > 0 ? amtANum * altUsdPerToken : null

  const usdB: number | null =
    tokenB.toUpperCase() === STABLE_SYM && amtBNum > 0 ? amtBNum * STABLE_USD_PRICE
      : tokenA.toUpperCase() === STABLE_SYM && altUsdPerToken !== null && amtBNum > 0 ? amtBNum * altUsdPerToken : null

  // Close settings on outside click
  useEffect(() => {
    function handler(e: MouseEvent) { if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false) }
    if (settingsOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  // Close token modal on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') setTokenModalFor(null) }
    if (tokenModalFor) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [tokenModalFor])

  // ── Derived action state ──────────────────────────────────────────
  const insuffA = !loadingBalances && walletConnected && !!address && amtANum > 0 && amtANum > balANum
  const insuffB = !loadingBalances && walletConnected && !!address && amtBNum > 0 && amtBNum > balBNum

  return (
    <>
      <div className="jlf-app">

        {/* LEFT: position card + pool info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Your LP Position */}
          <div className="jlf-panel" style={{ padding: '24px' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>Your LP position</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="jlf-tcoin" style={{ background: tColor(tokenA), width: 26, height: 26, fontSize: 11, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700 }}>{tGlyph(tokenA)}</span>
                <span className="jlf-tcoin" style={{ background: tColor(tokenB), width: 26, height: 26, fontSize: 11, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, marginLeft: -10 }}>{tGlyph(tokenB)}</span>
              </div>
            </div>

            {/* Underlying assets */}
            {underAUi !== '—' ? (
              <div className="jlf-pos-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <div style={{ padding: '14px 16px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 16 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{tokenA}</div>
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 18, fontWeight: 600, color: 'var(--white)', lineHeight: 1.2 }}>{underAUi}</div>
                  {usdA !== null && underAUi !== '—' && (
                    <div style={{ marginTop: 4, fontFamily: '"DM Mono"', fontSize: 11.5, color: 'var(--muted-2)' }}>
                      ≈ ${(Number(underAUi.replace(/,/g, '')) * (usdA / amtANum || 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
                <div style={{ padding: '14px 16px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 16 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{tokenB}</div>
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 18, fontWeight: 600, color: 'var(--white)', lineHeight: 1.2 }}>{underBUi}</div>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 20, padding: '20px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>No position yet</div>
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted-2)' }}>Add liquidity to start earning fees</div>
              </div>
            )}

            {/* LP share + LP tokens */}
            {lpShareUi !== '—' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 4 }}>Pool share</div>
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 17, fontWeight: 600, color: 'var(--green)' }}>{lpShareUi}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 4 }}>LP tokens</div>
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 17, fontWeight: 600, color: 'var(--white)' }}>{lpBalUi}</div>
                </div>
              </div>
            )}

            {/* Fees / P&L */}
            {feesPnlUi !== '—' && (
              <div style={{ padding: '12px 14px', background: 'rgba(54,211,153,.06)', border: '1px solid rgba(54,211,153,.14)', borderRadius: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Returns</div>
                <div style={{ fontFamily: '"DM Mono"', fontSize: 13, color: 'var(--muted)' }}>{feesPnlUi}</div>
                {feesPnlNote && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted-2)' }}>{feesPnlNote}</div>}
              </div>
            )}

            {/* Reconcile banner — Account Key holds a separate LP position */}
            {hasDistinctSigner && signerLpBalRaw > 0n && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.25)', borderRadius: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>⚠️</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#F59E0B' }}>Position on Account Key</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', lineHeight: 1.5, marginBottom: 10 }}>
                  Your Account Key holds a separate liquidity position in this pool.
                  Reconcile it to move the underlying tokens to your account.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontFamily: '"DM Mono"', fontSize: 11.5, color: 'var(--muted)' }}>
                    {signerUnderAUi} {tokenA} · {signerUnderBUi} {tokenB}
                  </span>
                  <button
                    onClick={onReconcileSigner}
                    disabled={reconcileBusy}
                    style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#F59E0B', background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.35)', borderRadius: 8, cursor: reconcileBusy ? 'not-allowed' : 'pointer', opacity: reconcileBusy ? 0.6 : 1 }}
                  >
                    {reconcileBusy ? 'Reconciling…' : 'Reconcile'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pool info */}
          <div className="jlf-panel" style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 16 }}>
              Pool reserves
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: poolHasReserves ? 14 : 0 }}>
              <div>
                <div style={{ fontFamily: '"DM Mono"', fontSize: 16, fontWeight: 500, color: 'var(--white)', lineHeight: 1.2 }}>{reserveAUi}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{tokenA}</div>
              </div>
              <div>
                <div style={{ fontFamily: '"DM Mono"', fontSize: 16, fontWeight: 500, color: 'var(--white)', lineHeight: 1.2 }}>{reserveBUi}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{tokenB}</div>
              </div>
            </div>
            {poolHasReserves && ratioAtoBNum !== null && (
              <div style={{ paddingTop: 14, borderTop: '1px solid var(--line-2)', fontFamily: '"DM Mono"', fontSize: 12.5, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>1&nbsp;{tokenA}&nbsp;≈&nbsp;{fmtRate(ratioAtoBNum)}&nbsp;{tokenB}</span>
                {altUsdPerToken !== null && <span>1&nbsp;{nonStableSym}&nbsp;≈&nbsp;${fmtUsd(altUsdPerToken)}</span>}
              </div>
            )}
            {lpTotalSupplyUi !== '—' && (
              <div style={{ marginTop: 8, fontFamily: '"DM Mono"', fontSize: 12.5, color: 'var(--muted-2)' }}>
                LP supply: {lpTotalSupplyUi}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Liquidity card */}
        <div className="jlf-swap-card jlf-swap-col">

          {/* ── Header: tabs + settings ── */}
          <div className="jlf-swap-top" ref={settingsRef}>
            <div className="jlf-stabs">
              <button className={activeTab === 'add' ? 'active' : ''} onClick={() => { setActiveTab('add'); setErr(null) }}>Add</button>
              <button className={activeTab === 'remove' ? 'active' : ''} onClick={() => { setActiveTab('remove'); setErr(null) }}>Remove</button>
            </div>
            <div className="jlf-stools">
              <button className="jlf-gear" onClick={() => setSettingsOpen(v => !v)} aria-label="Settings">
                <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/>
                  <path d="M19.4 13.5a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.18-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-2.18 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 002.18.33H9.5a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 2.18V12a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <span className="jlf-slip-badge">{(slippageBps / 100).toFixed(2)}%</span>
              </button>
            </div>
            <div className={`jlf-pop${settingsOpen ? ' open' : ''}`}>
              <h4>Max slippage</h4>
              <div className="jlf-slips">
                {[30, 50, 100].map((bps) => (
                  <button key={bps} className={slippageBps === bps ? 'active' : ''} onClick={() => { setSlippageBps(bps); setSettingsOpen(false) }}>
                    {(bps / 100).toFixed(2)}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ═══════════ ADD TAB ═══════════ */}
          {activeTab === 'add' && (
            <>
              {/* Token A leg */}
              <div className="jlf-leg">
                <div className="jlf-leg-top">
                  <span className="lab">{tokenA}</span>
                  <span className="bal">Balance:&nbsp;<b>{balADisplay}</b></span>
                </div>
                <div className="jlf-leg-row">
                  <input
                    className="jlf-amt"
                    value={amtA}
                    onChange={(e) => {
                      const v = clampAmountStr(e.target.value)
                      didUserEditRef.current = true; setLastEdited('A'); setAmtA(v); syncBFromA(v)
                    }}
                    placeholder="0"
                    inputMode="decimal"
                  />
                  <button className="jlf-tokbtn" onClick={() => { setTokenSearch(''); setTokenModalFor('A') }}>
                    <span className="jlf-tcoin" style={{ background: tColor(tokenA), width: 26, height: 26, fontSize: 11 }}>{tGlyph(tokenA)}</span>
                    <b>{tokenA}</b>
                    <span className="caret">▾</span>
                  </button>
                </div>
                <div className="jlf-leg-sub">
                  <span>{usdA !== null ? `≈ $${usdA.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null}</span>
                  <span className="jlf-max" onClick={() => { const v = balA.replace(/,/g, ''); if (v && v !== '—' && !isNaN(Number(v))) { setAmtA(v); syncBFromA(v); didUserEditRef.current = true; setLastEdited('A') } }}>Max</span>
                </div>
              </div>

              {/* Link connector */}
              <div className="jlf-flip">
                <button
                  onClick={() => {
                    const [a, b] = [tokenA, tokenB]; const [va, vb] = [amtA, amtB]
                    setTokenA(b); setTokenB(a); setAmtA(vb); setAmtB(va); setLastEdited('A'); didUserEditRef.current = true
                  }}
                  title="Swap token positions"
                >
                  <ArrowDownUp style={{ width: 16, height: 16 }} />
                </button>
              </div>

              {/* Token B leg */}
              <div className="jlf-leg" style={{ marginTop: 6 }}>
                <div className="jlf-leg-top">
                  <span className="lab">{tokenB}</span>
                  <span className="bal">Balance:&nbsp;<b>{balBDisplay}</b></span>
                </div>
                <div className="jlf-leg-row">
                  <input
                    className="jlf-amt"
                    value={amtB}
                    onChange={(e) => {
                      const v = clampAmountStr(e.target.value)
                      didUserEditRef.current = true; setLastEdited('B'); setAmtB(v); syncAFromB(v)
                    }}
                    placeholder="0"
                    inputMode="decimal"
                  />
                  <button className="jlf-tokbtn" onClick={() => { setTokenSearch(''); setTokenModalFor('B') }}>
                    <span className="jlf-tcoin" style={{ background: tColor(tokenB), width: 26, height: 26, fontSize: 11 }}>{tGlyph(tokenB)}</span>
                    <b>{tokenB}</b>
                    <span className="caret">▾</span>
                  </button>
                </div>
                <div className="jlf-leg-sub">
                  <span>{usdB !== null ? `≈ $${usdB.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null}</span>
                  <span className="jlf-max" onClick={() => { const v = balB.replace(/,/g, ''); if (v && v !== '—' && !isNaN(Number(v))) { setAmtB(v); syncAFromB(v); didUserEditRef.current = true; setLastEdited('B') } }}>Max</span>
                </div>
              </div>

              {/* Rate / details */}
              <div className="jlf-details">
                <div className="jlf-det-row" onClick={() => setPoolDetailsOpen(v => !v)}>
                  <span className="l">
                    {poolHasReserves && ratioAtoBNum !== null
                      ? `1 ${tokenA} ≈ ${fmtRate(ratioAtoBNum)} ${tokenB}`
                      : 'No pool yet — first deposit sets the price'}
                  </span>
                  <span className="r">
                    <span>{(slippageBps / 100).toFixed(2)}% slip</span>
                    <span className="ex" style={{ display: 'inline-block', transform: poolDetailsOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                  </span>
                </div>
                <div className={`jlf-det-body${poolDetailsOpen ? ' open' : ''}`}>
                  {lpShareUi !== '—' && (
                    <div className="jlf-det-line"><span className="k">Your share</span><span className="v">{lpShareUi}</span></div>
                  )}
                  {poolHasReserves && (
                    <div className="jlf-det-line"><span className="k">1 {tokenB} ≈</span><span className="v">{ratioBtoA} {tokenA}</span></div>
                  )}
                  <div className="jlf-det-line"><span className="k">Slippage</span><span className="v">{(slippageBps / 100).toFixed(2)}%</span></div>
                  {feesPnlUi !== '—' && (
                    <div className="jlf-det-line"><span className="k">P&amp;L / Fees</span><span className="v">{feesPnlUi}</span></div>
                  )}
                  {pairAddr !== '—' && (
                    <div className="jlf-det-line"><span className="k">Pair</span><span className="v" style={{ fontFamily: '"DM Mono"', fontSize: 11 }}>{pairAddr.slice(0, 10)}…{pairAddr.slice(-6)}</span></div>
                  )}
                </div>
              </div>

              {/* Pool gate warning */}
              {lpGate.blocked && !isAdmin && (
                <div style={{ margin: '6px 0', padding: '10px 14px', background: 'rgba(247,181,59,.08)', border: '1px solid rgba(247,181,59,.22)', borderRadius: 14, fontSize: 13, color: 'var(--gold)' }}>
                  {lpGate.reason}
                </div>
              )}

              {/* Error */}
              {err && (
                <div style={{ margin: '6px 0', padding: '10px 14px', background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.22)', borderRadius: 14, fontSize: 13, color: 'var(--red)', whiteSpace: 'pre-wrap' }}>
                  {err}
                </div>
              )}

              {/* Action button */}
              {(() => {
                if (!walletConnected || !address) {
                  return <button className="jlf-action" onClick={openConnectModal}>Connect Wallet</button>
                }
                const btnClass = insuffA || insuffB ? 'jlf-action warn' : busy || amtANum <= 0 || amtBNum <= 0 || (lpGate.blocked && !isAdmin) ? 'jlf-action idle' : 'jlf-action'
                return (
                  <button className={btnClass} disabled={busy} onClick={() => { if (!insuffA && !insuffB && amtANum > 0 && amtBNum > 0 && !(lpGate.blocked && !isAdmin)) void onAddLiquidity() }}>
                    {busy ? 'Confirming on-chain…' : insuffA ? `Insufficient ${tokenA}` : insuffB ? `Insufficient ${tokenB}` : amtANum <= 0 || amtBNum <= 0 ? 'Enter amounts' : 'Add Liquidity'}
                  </button>
                )
              })()}

              {addLiqDialogDetails && !addLiqDialogOpen && (
                <button onClick={() => setAddLiqDialogOpen(true)} style={{ marginTop: 7, width: '100%', background: 'rgba(54,211,153,.08)', border: '1px solid rgba(54,211,153,.2)', borderRadius: 'var(--r)', padding: '12px', fontWeight: 600, fontSize: 14, color: 'var(--green)', cursor: 'pointer', fontFamily: '"Bricolage Grotesque"' }}>
                  View liquidity status →
                </button>
              )}

            </>
          )}

          {/* ═══════════ REMOVE TAB ═══════════ */}
          {activeTab === 'remove' && (
            <div style={{ padding: '8px 0' }}>

              {/* Current position */}
              <div style={{ margin: '0 0 12px', padding: '14px 16px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 18 }}>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 10 }}>
                  {ain ? `AIN-${ain}'s position` : 'Your position'}
                </div>
                {underAUi !== '—' ? (
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 15, color: 'var(--white)', lineHeight: 1.6 }}>
                    {underAUi}&nbsp;<span style={{ color: 'var(--muted)' }}>{tokenA}</span>
                    <br />
                    {underBUi}&nbsp;<span style={{ color: 'var(--muted)' }}>{tokenB}</span>
                  </div>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>No position yet</div>
                )}
                {lpShareUi !== '—' && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-2)', fontSize: 12.5, fontFamily: '"DM Mono"', color: 'var(--muted)' }}>
                    {lpShareUi} pool share · LP: {lpBalUi}
                  </div>
                )}
              </div>

              {/* Remove percentage */}
              <div style={{ padding: '0 0 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--white)' }}>Remove amount</div>
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 15, fontWeight: 600, color: 'var(--white)' }}>{removePct}%</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[25, 50, 75, 100].map((p) => (
                    <button
                      key={p}
                      onClick={() => setRemovePct(p)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 10, border: '1px solid',
                        borderColor: removePct === p ? 'var(--red)' : 'var(--line)',
                        background: removePct === p ? 'rgba(255,90,60,.12)' : 'rgba(255,255,255,.03)',
                        color: removePct === p ? 'var(--red)' : 'var(--muted)',
                        fontWeight: 600, fontSize: 13.5, cursor: 'pointer', transition: '.14s',
                      }}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Pool gate warning */}
              {lpGate.blocked && (
                <div style={{ padding: '10px 14px', marginBottom: 10, background: 'rgba(247,181,59,.08)', border: '1px solid rgba(247,181,59,.22)', borderRadius: 14, fontSize: 13, color: 'var(--gold)' }}>
                  <b>Pool in repair mode</b><br />{lpGate.reason}
                </div>
              )}

              {/* Error / info */}
              {err && (
                <div style={{ padding: '10px 14px', marginBottom: 10, background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.22)', borderRadius: 14, fontSize: 13, color: 'var(--red)', whiteSpace: 'pre-wrap' }}>
                  {err}
                </div>
              )}
              {info && (
                <div style={{ padding: '10px 14px', marginBottom: 10, background: 'rgba(54,211,153,.06)', border: '1px solid rgba(54,211,153,.18)', borderRadius: 14, fontSize: 13, color: 'var(--green)' }}>
                  {info}
                </div>
              )}

              {/* Remove button */}
              {(() => {
                if (!walletConnected || !address) return <button className="jlf-action" onClick={openConnectModal}>Connect Wallet</button>
                const disabled = busy || pairAddr === '—' || lpBalUi === '—' || lpBalUi === '0'
                return (
                  <button className={`jlf-action${disabled ? ' idle' : ''}`} disabled={busy} onClick={() => { if (!disabled) void onRemoveLiquidity() }}>
                    {busy ? 'Confirming…' : 'Remove Liquidity'}
                  </button>
                )
              })()}

              {/* Admin repair */}
              {isAdmin && pairAddr !== '—' && lpGate.blocked && (
                <div style={{ marginTop: 14, padding: '14px 16px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 18 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--white)', marginBottom: 12 }}>Admin repair (Donate + Sync)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      className="jlf-amt"
                      style={{ fontSize: 15, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--white)' }}
                      value={repairA}
                      onChange={(e) => setRepairA(clampAmountStr(e.target.value))}
                      placeholder={`Donate ${tokenA}`}
                      inputMode="decimal"
                    />
                    <input
                      className="jlf-amt"
                      style={{ fontSize: 15, padding: '10px 14px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--white)' }}
                      value={repairB}
                      onChange={(e) => setRepairB(clampAmountStr(e.target.value))}
                      placeholder={`Donate ${tokenB}`}
                      inputMode="decimal"
                    />
                    <button className={`jlf-action${busy ? ' idle' : ''}`} disabled={busy} onClick={onRepairPool}>
                      Repair pool
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Token selection modal ── */}
      <div className={`jlf-overlay${tokenModalFor ? ' open' : ''}`} onClick={() => setTokenModalFor(null)}>
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
                placeholder="Search token"
                autoComplete="off"
                autoFocus={!!tokenModalFor}
              />
            </div>
            <div className="jlf-popular">
              {tokenOptions.slice(0, 5).map(sym => (
                <button key={sym} className="jlf-ptok" onClick={() => {
                  if (tokenModalFor === 'A') { if (sym === tokenB) { setTokenA(sym as TokenKey); setTokenB(tokenA) } else setTokenA(sym as TokenKey) }
                  else { if (sym === tokenA) { setTokenB(sym as TokenKey); setTokenA(tokenB) } else setTokenB(sym as TokenKey) }
                  setTokenModalFor(null)
                }}>
                  <span className="jlf-tcoin" style={{ background: tColor(sym), width: 22, height: 22, fontSize: 10 }}>{tGlyph(sym)}</span>
                  {sym}
                </button>
              ))}
            </div>
          </div>
          <div className="jlf-tlist">
            {tokenOptions
              .filter(sym => !tokenSearch || sym.toLowerCase().includes(tokenSearch.toLowerCase()))
              .map(sym => (
                <div key={sym} className="it" onClick={() => {
                  if (tokenModalFor === 'A') { if (sym === tokenB) { setTokenA(sym as TokenKey); setTokenB(tokenA) } else setTokenA(sym as TokenKey) }
                  else { if (sym === tokenA) { setTokenB(sym as TokenKey); setTokenA(tokenB) } else setTokenB(sym as TokenKey) }
                  setTokenModalFor(null)
                }}>
                  <span className="jlf-tcoin" style={{ background: tColor(sym), flexShrink: 0 }}>{tGlyph(sym)}</span>
                  <span className="nm"><b>{sym}</b></span>
                  <span className="hold">
                    <b>{sym === tokenA ? balADisplay : sym === tokenB ? balBDisplay : '—'}</b>
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Add liquidity progress modal ── */}
      {addLiqDialogOpen && addLiqDialogDetails && (
        <AddLiqProgressModal
          phase={addLiqDialogPhase}
          details={addLiqDialogDetails}
          preAddBals={preAddBals}
          balA={balA}
          balB={balB}
          lpShareUi={lpShareUi}
          err={addLiqDialogErr}
          onClose={() => setAddLiqDialogOpen(false)}
        />
      )}
    </>
  )
}

function AddLiqProgressModal({
  phase, details, preAddBals, balA, balB, lpShareUi, err, onClose,
}: {
  phase: 'confirming' | 'success' | 'error'
  details: { symA: string; symB: string; amtA: string; amtB: string; txHash: string }
  preAddBals: { a: string; b: string } | null
  balA: string; balB: string; lpShareUi: string; err: string | null; onClose: () => void
}) {
  const isDone = phase === 'success'; const isError = phase === 'error'; const isActive = !isDone && !isError
  const steps = [
    { label: 'Transaction submitted', sublabel: `${details.txHash.slice(0, 10)}…${details.txHash.slice(-6)}`, done: true, active: false },
    { label: 'Awaiting on-chain confirmation', done: isDone, active: isActive },
    { label: 'Liquidity added', done: isDone, active: false },
  ]

  const headerBg = isDone ? 'rgba(54,211,153,.08)' : isError ? 'rgba(255,90,60,.08)' : 'rgba(247,181,59,.06)'
  const headerColor = isDone ? 'var(--green)' : isError ? 'var(--red)' : 'var(--gold)'

  return (
    <div className="jlf-overlay open" onClick={onClose}>
      <div className="jlf-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="jlf-modal-head" style={{ background: headerBg, borderBottom: '1px solid var(--line-2)' }}>
          <div className="row1">
            <h3 style={{ color: headerColor }}>
              {isDone ? 'Liquidity added' : isError ? 'Transaction failed' : 'Adding liquidity…'}
            </h3>
            {(isDone || isError) && <button className="x" onClick={onClose}>✕</button>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, paddingBottom: 4 }}>
            {isDone ? `${details.amtA} ${details.symA} + ${details.amtB} ${details.symB} deposited.`
              : isError ? 'See details below.'
              : `${details.amtA} ${details.symA} + ${details.amtB} ${details.symB} · Alkebuleum`}
          </div>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '60vh', overflowY: 'auto' }}>

          {/* Steps */}
          {!isError && (
            <div>
              {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0, background: step.done ? 'var(--green)' : step.active ? 'var(--red)' : 'var(--surface-2)', color: step.done || step.active ? '#fff' : 'var(--muted)', fontWeight: 700, fontSize: 13 }}>
                      {step.active && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--red)', opacity: 0.3, animation: 'jlf-spin .7s linear infinite' }} />}
                      {step.done ? '✓' : step.active ? <div className="jlf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> : i + 1}
                    </div>
                    {i < steps.length - 1 && <div style={{ width: 1, flex: 1, minHeight: 20, marginBlock: 4, background: step.done ? 'var(--green)' : 'var(--line-2)' }} />}
                  </div>
                  <div style={{ paddingBottom: 16, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: step.done ? 'var(--green)' : step.active ? 'var(--white)' : 'var(--muted)' }}>{step.label}</div>
                    {step.sublabel && <div style={{ marginTop: 2, fontFamily: '"DM Mono"', fontSize: 11.5, color: 'var(--muted)' }}>{step.sublabel}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {isError && err && (
            <div style={{ padding: '12px 16px', background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.22)', borderRadius: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>Error</div>
              <div style={{ fontSize: 13, color: '#ff7a4d', whiteSpace: 'pre-wrap' }}>{err}</div>
            </div>
          )}

          {/* Live balances */}
          <div style={{ padding: '14px 16px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-2)', marginBottom: 12 }}>
              {isDone ? 'Updated balances' : 'Live balances'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[{ sym: details.symA, bal: balA, pre: preAddBals?.a }, { sym: details.symB, bal: balB, pre: preAddBals?.b }].map(({ sym, bal, pre }) => (
                <div key={sym} style={{ padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--line-2)', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{sym}</div>
                  <div style={{ fontFamily: '"DM Mono"', fontSize: 15, fontWeight: 600, color: isDone ? 'var(--red)' : 'var(--white)' }}>{bal}</div>
                  {isDone && pre && pre !== bal && <div style={{ fontFamily: '"DM Mono"', fontSize: 11, color: 'var(--muted-2)', textDecoration: 'line-through', marginTop: 2 }}>{pre}</div>}
                </div>
              ))}
            </div>
            {isDone && lpShareUi !== '—' && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(54,211,153,.08)', border: '1px solid rgba(54,211,153,.18)', borderRadius: 10 }}>
                <div style={{ fontSize: 11.5, color: 'var(--green)' }}>Pool share</div>
                <div style={{ fontFamily: '"DM Mono"', fontSize: 14, fontWeight: 600, color: 'var(--green)', marginTop: 2 }}>{lpShareUi}</div>
              </div>
            )}
          </div>

          {/* Close */}
          {(isDone || isError) && (
            <button className="jlf-action" onClick={onClose}>{isDone ? 'Close' : 'Dismiss'}</button>
          )}
          {isActive && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted-2)' }}>Alkebuleum transactions typically confirm in under 30 seconds.</div>
          )}
        </div>
      </div>
    </div>
  )
}
