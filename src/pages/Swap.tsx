import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import { useAuth, sendTransactions } from 'amvault-connect'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useLocation, useSearchParams } from 'react-router-dom'
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

import WalletSummaryCard from '../components/WalletSummaryCard'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

type PricePoint = { t: number; p: number }

const PRICE_PAIR_KEY = 'jswap:pricehist:v1:MAH-AKE'
const PRICE_SAMPLE_MS = 5 * 60 * 1000 // 5 min
const PRICE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function hexValue(v: any): string {
  if (v == null) return '0x0'
  if (typeof v === 'bigint') return ethers.toBeHex(v)
  if (typeof v === 'number') return ethers.toBeHex(BigInt(v))
  if (typeof v === 'string') return v
  return '0x0'
}

function normalizeTxForAmVault(tx: any) {
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
  const { session } = useAuth()
  const walletConnected = !!session
  const address = session?.address ?? null

  const provider = useMemo(() => new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID), [])
  const [sp] = useSearchParams()
  const location = useLocation()
  const didInitRef = useRef(false)

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

  const [from, setFrom] = useState<TokenSym>('MAH')
  const [to, setTo] = useState<TokenSym>('ALKE')

  const [amount, setAmount] = useState('10')

  const [fromBal, setFromBal] = useState('—')
  const [toBal, setToBal] = useState('—')
  const [loadingBalances, setLoadingBalances] = useState(false)

  const [slippageBps, setSlippageBps] = useState<number>(() => readSlippageBps(50))
  const [hideBalances, setHideBalances] = useState<boolean>(() => readHideBalances())

  const [quoteOut, setQuoteOut] = useState<string>('—')
  const [minOut, setMinOut] = useState<string>('—')

  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const quoteTimer = useRef<number | null>(null)

  const SWAP_PREFLIGHT = {
    flow: 'swap_v1',
    gasTopup: { enabled: true, purpose: 'jswap-swap' },
  } as any

  const [priceData, setPriceData] = useState<PricePoint[]>(() => {
    try {
      const raw = localStorage.getItem(PRICE_PAIR_KEY)
      const arr = raw ? (JSON.parse(raw) as PricePoint[]) : []
      const now = Date.now()
      return Array.isArray(arr)
        ? arr.filter((x) => x && typeof x.t === 'number' && typeof x.p === 'number' && x.t >= now - PRICE_WINDOW_MS)
        : []
    } catch {
      return []
    }
  })

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
    let alive = true
    let timer: number | null = null

    async function sample() {
      try {
        if (!TOKENS.MAH || !TOKENS.ALKE) return

        const fromDec = await readDecimals(TOKENS.MAH, provider)
        const toDec = await readDecimals(TOKENS.ALKE, provider)

        const amountIn = ethers.parseUnits('1', fromDec)
        const { amountOut } = await getQuoteOut({ from: TOKENS.MAH, to: TOKENS.ALKE, amountIn })

        const p = Number(ethers.formatUnits(amountOut, toDec))
        if (!Number.isFinite(p) || p <= 0) return

        const now = Date.now()
        const pt: PricePoint = { t: now, p }

        if (!alive) return

        setPriceData((prev) => {
          const next = [...prev, pt].filter((x) => x.t >= now - PRICE_WINDOW_MS)
          try {
            localStorage.setItem(PRICE_PAIR_KEY, JSON.stringify(next))
          } catch { }
          return next
        })
      } catch { }
    }

    sample()
    timer = window.setInterval(sample, PRICE_SAMPLE_MS)

    return () => {
      alive = false
      if (timer) window.clearInterval(timer)
    }
  }, [provider])

  function tokenKeyFromParam(v: string | null): TokenSym | null {
    if (!v) return null
    const s = v.trim()
    if (!s) return null

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

    const fallbackFrom = tokenOptions.includes('MAH') ? 'MAH' : tokenOptions[0]
    const fallbackTo =
      tokenOptions.includes('ALKE')
        ? 'ALKE'
        : tokenOptions.find((x) => x !== fallbackFrom) ?? fallbackFrom

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
    async function load() {
      setLoadingBalances(true)
      try {
        if (!address) {
          if (!alive) return
          setFromBal('—')
          setToBal('—')
          return
        }
        const A = getToken(from)
        const B = getToken(to)

        if (!A || !B) {
          setFromBal('—')
          setToBal('—')
          return
        }

        const [b1, b2] = await Promise.all([
          getBalance(address, A, provider),
          getBalance(address, B, provider),
        ])

        const d1 = await readDecimals(A, provider)
        const d2 = await readDecimals(B, provider)

        setFromBal(fmtNum(ethers.formatUnits(b1, d1)))
        setToBal(fmtNum(ethers.formatUnits(b2, d2)))
      } catch (e: any) {
        if (!alive) return
        console.warn('balance refresh failed', e?.message || e)
      } finally {
        if (!alive) return
        setLoadingBalances(false)
      }
    }

    load()
    const id = window.setInterval(load, 12000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [address, from, to, provider])

  useEffect(() => {
    if (quoteTimer.current) window.clearTimeout(quoteTimer.current)

    quoteTimer.current = window.setTimeout(async () => {
      setErr(null)
      setInfo(null)

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
        const A = getToken(from)
        const B = getToken(to)
        if (!A || !B) {
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
        setErr(e?.shortMessage || e?.message || 'Quote failed.')
      }
    }, 250)

    return () => {
      if (quoteTimer.current) window.clearTimeout(quoteTimer.current)
    }
  }, [amount, from, to, slippageBps, address, provider])

  async function onSwap() {
    setErr(null)
    setInfo(null)
    setBusy(true)

    try {
      if (!walletConnected || !address) throw new Error('Connect amVault using the top bar to continue.')
      if (from === to) throw new Error('Select different tokens.')
      if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')

      const amtStr = clampAmountStr(amount.trim())
      if (!amtStr || Number(amtStr) <= 0) throw new Error('Enter a valid amount.')

      const fromToken = getToken(from)
      const toToken = getToken(to)
      if (!fromToken || !toToken) throw new Error('Token registry is still loading. Try again.')

      const fromDec = await readDecimals(fromToken, provider)
      const toDec = await readDecimals(toToken, provider)

      const amountIn = ethers.parseUnits(amtStr, fromDec)
      const { path, amountOut } = await getQuoteOut({ from: fromToken, to: toToken, amountIn })
      const amountOutMin = applySlippage(amountOut, slippageBps)

      const txs: any[] = []

      if (!fromToken.isNative) {
        const allowance = await getAllowance(address, fromToken, ROUTER, provider)
        if (allowance < amountIn) {
          const approveTx = buildApproveTx(fromToken, ROUTER, amountIn)
          if (approveTx) txs.push(approveTx)
        }
      }

      const swapTx = buildSwapTx({
        from: fromToken,
        to: toToken,
        amountIn,
        amountOutMin,
        path,
        recipient: address,
        deadlineSec: 10 * 60,
      })
      txs.push(swapTx)

      setInfo('Swap queued. Confirm in AmVault…')

      const safeTxs = txs.map(normalizeTxForAmVault)

      const results = await sendTransactions(
        {
          chainId: ALK_CHAIN_ID,
          txs: safeTxs,
          failFast: true,
          preflight: SWAP_PREFLIGHT,
        } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = results?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const hashes: string[] = (results || [])
        .map((r: any) => r?.txHash as string | undefined)
        .filter(Boolean) as string[]

      setInfo('Waiting for on-chain confirmation…')

      let lastReason: string | null = null
      for (const h of hashes) {
        const r = await waitForReceipt(provider, h)
        if (!r) {
          lastReason = 'Not confirmed (timeout)'
          break
        }
        if (r.status === 0) {
          lastReason = (await getRevertReasonFromChain(provider, h)) ?? 'reverted (no reason decoded)'
          break
        }
      }

      if (lastReason) {
        setErr(`Swap reverted: ${lastReason}`)
        setInfo(null)
      } else {
        setInfo('Swap confirmed on-chain ✅')
      }

      window.setTimeout(async () => {
        if (!address) return
        try {
          const [b1, b2] = await Promise.all([
            getBalance(address, fromToken, provider),
            getBalance(address, toToken, provider),
          ])
          setFromBal(fmtNum(ethers.formatUnits(b1, fromDec)))
          setToBal(fmtNum(ethers.formatUnits(b2, toDec)))
        } catch { }
      }, 2500)
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Swap failed.')
      setInfo(null)
    } finally {
      setBusy(false)
    }
  }

  const fromBalDisplay = hideBalances ? '•••' : (loadingBalances ? '…' : fromBal)
  const toBalDisplay = hideBalances ? '•••' : (loadingBalances ? '…' : toBal)

  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Swap</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Swap tokens on Alkebuleum using the V1 router.
          </p>
        </div>

        <WalletSummaryCard
          walletConnected={walletConnected}
          address={address}
          stats={[
            { label: from, value: fromBalDisplay },
            { label: to, value: toBalDisplay },
          ]}
          notConnectedHint="Connect amVault using the top bar to enable swapping."
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          {/* Swap */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Swap</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Router: <span className="font-mono">{ROUTER ? shortAddr(ROUTER) : '—'}</span>
                </div>
              </div>
              <Badge>Alkebuleum</Badge>
            </div>

            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">From</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Bal: {fromBalDisplay}</div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <select
                    className="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  >
                    {tokenOptions.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>

                  <input
                    value={amount}
                    onChange={(e) => setAmount(clampAmountStr(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="10"
                    inputMode="decimal"
                  />

                  <button
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      setErr(null)
                      setInfo(null)
                      setFrom(to)
                      setTo(from)
                    }}
                    title="Flip"
                  >
                    ↕
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">To</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Bal: {toBalDisplay}</div>
                </div>

                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    className="w-28 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  >
                    {tokenOptions.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>

                  <div className="flex-1 min-w-0 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Est.</span>
                      <span className="text-right font-semibold tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
                        {quoteOut}
                      </span>

                      <span className="text-slate-500 dark:text-slate-400">Min</span>
                      <span className="text-right font-semibold tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {minOut}
                      </span>
                    </div>
                  </div>
                </div>

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
              </div>

              {err && (
                <div className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  {err}
                </div>
              )}
              {info && (
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                  {info}
                </div>
              )}

              <button
                onClick={onSwap}
                disabled={!walletConnected || !address || busy}
                className="w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Confirm in AmVault…' : 'Preview & Swap'}
              </button>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                Uses router quote + slippage minOut. No auto-switching.
              </div>
            </div>
          </div>

          {/* Price */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Price</div>
              <Badge>V1</Badge>
            </div>

            {priceData.length < 2 && (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Collecting price samples…</div>
            )}

            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceData}>
                  <XAxis dataKey="t" hide />
                  <YAxis hide />
                  <Tooltip />
                  <Line type="monotone" dataKey="p" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
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
