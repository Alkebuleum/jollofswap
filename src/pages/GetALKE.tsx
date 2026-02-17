// src/pages/GetALKE.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ethers, Interface } from 'ethers'
import { useAuth, sendTransactions } from 'amvault-connect'
import WalletSummaryCard from '../components/WalletSummaryCard'
import { useWalletMetaStore } from '../store/walletMetaStore'

type Step = 'buy' | 'bridge'

const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 80002) // Amoy
const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)



const POLY_RPC =
  (import.meta.env.VITE_POLY_RPC as string) ?? 'https://rpc-amoy.polygon.technology'
const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'

const USDC_POLY =
  (import.meta.env.VITE_USDC_POLY as string) ?? '0x8B0180f2101c8260d49339abfEe87927412494B4'

const BRIDGEVAULT_POLY =
  (import.meta.env.VITE_BRIDGEVAULT_POLY as string) ?? '0x92330A70BEF78140A543B6C13D0bf67bE148ADe3'

const MAH_ALK =
  (import.meta.env.VITE_MAH_ALK as string) ?? '0xe0763F860fB39002099Fd6cE7aA1BbEd1ca0804d'

const BRIDGE_API =
  (import.meta.env.VITE_BRIDGE_API as string) ?? 'https://bridge.jollofswap.com'

const MOONPAY_BASE = (import.meta.env.VITE_MOONPAY_BASE as string) ?? 'https://buy.moonpay.com'

// These two are used by amvault-connect to route requests to your vault
const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

const UI_FEE_BPS = Number(import.meta.env.VITE_BRIDGE_FEE_BPS ?? 10) // 0.10% = 10 bps
const UI_FEE_MIN_USD = Number(import.meta.env.VITE_BRIDGE_FEE_MIN_USD ?? 0.10)
const UI_FEE_MAX_USD = Number(import.meta.env.VITE_BRIDGE_FEE_MAX_USD ?? 2.0)

// must match backend MAH_PER_USDC
const UI_MAH_PER_USDC = Number(import.meta.env.VITE_MAH_PER_USDC ?? 100)

const ALKE = {
  symbol: 'ALKE',
  networkName: 'Alkebuleum',
}

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const ERC20_IFACE = new Interface(['function approve(address spender, uint256 amount) returns (bool)'])

const BRIDGEVAULT_IFACE = new Interface([
  'function deposit(uint256 amount, address alkRecipient) returns (bytes32)',
])

const THEME_KEY = 'jswap_theme'
function readLS(key: string, fallback: string) {
  try {
    const v = window.localStorage.getItem(key)
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function clampAmountStr(v: string) {
  return v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
}

export default function GetALKE() {
  // If you already do this globally in AppLayout, you can remove this block.
  useLayoutEffect(() => {
    const dark = readLS(THEME_KEY, 'light') === 'dark'
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  const { session } = useAuth()
  const walletConnected = !!session
  const address = session?.address
  const { ain, ainLoading } = useWalletMetaStore()

  const [step, setStep] = useState<Step>('buy')

  const [usdcBal, setUsdcBal] = useState<string>('—')
  const [mahBal, setMahBal] = useState<string>('—')
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [polBal, setPolBal] = useState<string>('—')

  const [amount, setAmount] = useState('10')
  const [bridgeErr, setBridgeErr] = useState<string | null>(null)
  const [bridgeInfo, setBridgeInfo] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [mintedTx, setMintedTx] = useState<string | null>(null)
  const [pollStatus, setPollStatus] = useState<string | null>(null)
  const pollingRef = useRef<number | null>(null)
  const mahBeforeRef = useRef<bigint | null>(null)
  const pollTickRef = useRef(0)

  const [debugOpen, setDebugOpen] = useState(false)
  const [lastBridgeJson, setLastBridgeJson] = useState<string>('')

  const [mintOpen, setMintOpen] = useState(false)
  const [mintDetails, setMintDetails] = useState<{
    depositTx: string
    mintTx?: string | null
    estMah?: string | null
  } | null>(null)

  const estMahRef = useRef<string | null>(null)


  const BRIDGE_PREFLIGHT = {
    flow: 'bridge_usdc_to_mah',
    gasTopup: {
      enabled: true,
      purpose: 'jswap-bridge',
      // optional hints (AmVault clamps anyway)
      minBalanceWei: '39724141524600000',
      targetBalanceWei: '47668969829520000',
    },
  } as any

  const moonpayLink = useMemo(() => {
    const params = new URLSearchParams()
    params.set('currencyCode', 'usdc')
    if (address) params.set('walletAddress', address)
    return `${MOONPAY_BASE}?${params.toString()}`
  }, [address])

  const feeQuote = useMemo(() => {
    const amtStr = clampAmountStr(amount.trim())
    const amt = Number(amtStr || '0')
    if (!Number.isFinite(amt) || amt <= 0) {
      return { amt: 0, fee: 0, net: 0, mahNet: 0, ok: false }
    }

    const pct = (amt * UI_FEE_BPS) / 10000
    const fee = Math.min(UI_FEE_MAX_USD, Math.max(UI_FEE_MIN_USD, pct))
    const net = Math.max(0, amt - fee)
    const mahNet = net * UI_MAH_PER_USDC

    return { amt, fee, net, mahNet, ok: net > 0 }
  }, [amount])

  const polyProvider = useMemo(() => new ethers.JsonRpcProvider(POLY_RPC, POLY_CHAIN_ID), [])
  const alkProvider = useMemo(() => new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID), [])

  // balances
  useEffect(() => {
    let alive = true

    async function load() {
      setLoadingBalances(true)
      try {
        if (!address) {
          if (!alive) return
          setUsdcBal('—')
          setMahBal('—')
          setPolBal('—')
          return
        }

        const usdc = new ethers.Contract(USDC_POLY, ERC20_ABI, polyProvider)
        const usdcDec: number = await usdc.decimals()
        const usdcRaw: bigint = await usdc.balanceOf(address)
        const usdcFmt = ethers.formatUnits(usdcRaw, usdcDec)

        const mah = new ethers.Contract(MAH_ALK, ERC20_ABI, alkProvider)
        const mahDec: number = await mah.decimals()
        const mahRaw: bigint = await mah.balanceOf(address)
        const mahFmt = ethers.formatUnits(mahRaw, mahDec)

        const polRaw: bigint = await polyProvider.getBalance(address)
        const polFmt = ethers.formatEther(polRaw)

        if (!alive) return
        const fmt = (s: string) => {
          const n = Number(s)
          if (!Number.isFinite(n)) return s
          return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
        }
        setUsdcBal(fmt(usdcFmt))
        setMahBal(fmt(mahFmt))
        setPolBal(fmt(polFmt))
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
  }, [address, polyProvider, alkProvider])

  // stop polling when unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current)
      pollTickRef.current = 0
    }
  }, [])

  function normalizeAmvaultChainError(e: any) {
    const msg = String(e?.message || e || '')

    if (
      msg.includes('RPC chainId') &&
      msg.includes('requested') &&
      msg.includes(String(POLY_CHAIN_ID))
    ) {
      return (
        `AmVault isn’t configured for Polygon transactions yet.\n\n` +
        `Fix in AmVault: route chainId ${POLY_CHAIN_ID} to a Polygon Amoy RPC.\n` +
        `After that, Approve & Deposit can be sent via AmVault without MetaMask.`
      )
    }

    if (msg.toLowerCase().includes('insufficient funds') || msg.toLowerCase().includes('insufficient balance')) {
      return (
        `Not enough POL to pay Polygon gas.\n\n` +
        `We can *try* to top up a small amount of POL automatically, but it’s not guaranteed.\n` +
        `If the top-up fails or is unavailable:\n` +
        `• Add POL to your wallet on Polygon Amoy (chainId ${POLY_CHAIN_ID})\n` +
        `• Or try again later`
      )
    }

    if (msg.toLowerCase().includes('topup') || msg.toLowerCase().includes('faucet')) {
      return (
        `Gas top-up is temporarily unavailable.\n\n` +
        `You can still continue by adding a small amount of POL to your wallet on Polygon Amoy (chainId ${POLY_CHAIN_ID}), ` +
        `or try again later.`
      )
    }

    return e?.shortMessage || e?.message || 'Deposit failed.'
  }

  async function onDeposit() {
    setBridgeErr(null)
    setBridgeInfo(null)
    setTxHash(null)
    setMintedTx(null)
    setPollStatus(null)

    if (!walletConnected || !address) {
      setBridgeErr('Connect amVault using the top bar to continue.')
      return
    }

    const amtStr = clampAmountStr(amount.trim())
    if (!amtStr || Number(amtStr) <= 0) {
      setBridgeErr('Enter a valid USDC amount.')
      return
    }

    try {
      const usdcRead = new ethers.Contract(USDC_POLY, ERC20_ABI, polyProvider)
      const usdcDec: number = await usdcRead.decimals()
      const amt = ethers.parseUnits(amtStr, usdcDec)

      const allowance: bigint = await usdcRead.allowance(address, BRIDGEVAULT_POLY)

      const txs: Array<{
        to?: string
        data?: string
        value?: string | number | bigint
        gas?: number
        maxFeePerGasGwei?: number
        maxPriorityFeePerGasGwei?: number
      }> = []

      let approveIncluded = false

      if (allowance < amt) {
        const dataApprove = ERC20_IFACE.encodeFunctionData('approve', [BRIDGEVAULT_POLY, amt])
        txs.push({
          to: USDC_POLY,
          data: dataApprove,
          value: 0,
          gas: 120_000,
        })
        approveIncluded = true
      }

      const dataDeposit = BRIDGEVAULT_IFACE.encodeFunctionData('deposit', [amt, address])
      txs.push({
        to: BRIDGEVAULT_POLY,
        data: dataDeposit,
        value: 0,
        gas: 300_000,
      })

      setBridgeInfo(
        approveIncluded
          ? 'Approve + Deposit queued. Confirm in AmVault… (it may top up POL automatically)'
          : 'Deposit queued. Confirm in AmVault… (it may top up POL automatically)'
      )

      try {
        const mahRead = new ethers.Contract(MAH_ALK, ERC20_ABI, alkProvider)
        mahBeforeRef.current = await mahRead.balanceOf(address)
      } catch {
        mahBeforeRef.current = null
      }

      // estimated MAH user should receive (after UI fee)
      estMahRef.current = feeQuote.ok ? feeQuote.mahNet.toFixed(6) : null


      const results = await sendTransactions(
        {
          chainId: POLY_CHAIN_ID,
          txs,
          failFast: true,
          preflight: BRIDGE_PREFLIGHT,
        } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = results?.find((r) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const depositResult = results[results.length - 1]
      const depositHash = depositResult?.txHash
      if (!depositHash) throw new Error('No deposit txHash returned from AmVault')

      setTxHash(depositHash)
      setBridgeInfo('Deposit sent. Waiting for confirmations…')
      startPolling(depositHash)
    } catch (e: any) {
      console.error(e)
      setBridgeErr(normalizeAmvaultChainError(e))
      setBridgeInfo(null)
    }
  }

  function startPolling(hash: string) {
    if (pollingRef.current) window.clearInterval(pollingRef.current)

    const REQUIRED = 10

    const tick = async () => {
      try {
        setPollStatus('Checking bridge status…')

        const url = `${BRIDGE_API}/deposits/${hash}?t=${Date.now()}`
        const res = await fetch(url, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        setLastBridgeJson(JSON.stringify(data, null, 2))

        if (!res.ok || !data?.ok) {
          const err = data?.error || res.statusText || 'unknown'
          setPollStatus(`Bridge status unavailable: ${err}`)
          return
        }

        const conf = Number(data?.polygon?.confirmations ?? 0)

        const deposits = Array.isArray(data?.deposits) ? data.deposits : []
        const mintTxHash =
          data?.mintTxHash ||
          data?.mintedTxHash ||
          data?.minted?.mintTxHash ||
          deposits.find((d: any) => d?.mintTxHash)?.mintTxHash ||
          deposits.find((d: any) => d?.mintedTxHash)?.mintedTxHash ||
          deposits.find((d: any) => d?.minted?.mintTxHash)?.minted?.mintTxHash ||
          null

        const mintedAt =
          data?.mintedAt ||
          data?.minted?.mintedAt ||
          deposits.find((d: any) => d?.mintedAt)?.mintedAt ||
          null

        if (mintTxHash || mintedAt) {
          if (mintTxHash) setMintedTx(mintTxHash)

          setMintDetails({
            depositTx: hash,
            mintTx: mintTxHash ?? null,
            estMah: estMahRef.current,
          })
          setMintOpen(true)

          setBridgeInfo(null)
          setPollStatus(null)
          if (pollingRef.current) window.clearInterval(pollingRef.current)
          pollingRef.current = null
          return
        }


        if (conf >= REQUIRED) {
          setPollStatus('Confirmed ✅ Waiting for bridge worker to mint…')
        } else {
          setPollStatus(`Confirmations: ${conf}/${REQUIRED}`)
        }

        pollTickRef.current += 1
        if (mahBeforeRef.current != null && pollTickRef.current % 3 === 0) {
          try {
            const mahRead = new ethers.Contract(MAH_ALK, ERC20_ABI, alkProvider)
            const now = await mahRead.balanceOf(address)

            if (now > mahBeforeRef.current) {
              setMintDetails({
                depositTx: hash,
                mintTx: null,
                estMah: estMahRef.current,
              })
              setMintOpen(true)

              setBridgeInfo(null)
              setPollStatus(null)
              if (pollingRef.current) window.clearInterval(pollingRef.current)
              pollingRef.current = null
              return
            }

          } catch {
            // ignore
          }
        }
      } catch {
        setPollStatus('Deposit sent. Mint will appear when processed.')
      }
    }

    tick()
    pollingRef.current = window.setInterval(tick, 4000)
  }

  const canShowSwapNow = useMemo(() => {
    const n = Number((mahBal || '').replace(/,/g, ''))
    return Number.isFinite(n) && n > 0
  }, [mahBal])

  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Get {ALKE.symbol}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            USDC (Polygon) → MAH (Alkebuleum) → {ALKE.symbol}.
          </p>
        </div>

        <WalletSummaryCard
          walletConnected={walletConnected}
          address={address}
          ain={ainLoading ? null : ain}
          stats={[
            { label: 'USDC', value: loadingBalances ? '…' : usdcBal },
            { label: 'MAH', value: loadingBalances ? '…' : mahBal },
          ]}
          notConnectedHint="Connect amVault to bridge USDC → MAH."
        />

        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <StepTab active={step === 'buy'} n="1" title="Buy USDC" subtitle="Polygon" onClick={() => setStep('buy')} />
          <StepTab active={step === 'bridge'} n="2" title="Bridge to MAH" subtitle="Alkebuleum" onClick={() => setStep('bridge')} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {step === 'buy' && (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Step 1 — Buy USDC (Polygon)
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Buy USDC on Polygon to your address, then bridge it to MAH.
                  </div>
                </div>
                <div className="shrink-0">
                  <Badge>Network: Polygon</Badge>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <a
                  className="rounded-xl bg-orange-600 px-4 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-orange-700"
                  href={moonpayLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  Buy USDC
                </a>
                <button
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setStep('bridge')}
                >
                  I already have USDC → Continue
                </button>
              </div>

              {/*   <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                Use <span className="font-semibold">Polygon</span> and buy to your wallet address shown above.
              </div> */}
            </div>
          )}

          {step === 'bridge' && (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 sm:flex-1">
                  <div className="text-base sm:text-lg font-bold leading-tight text-slate-900 dark:text-slate-100">
                    Step 2 — Bridge USDC → MAH
                  </div>
                  <div className="mt-1 text-xs sm:text-sm text-slate-600 leading-snug dark:text-slate-400">
                    Deposit USDC to the BridgeVault on Polygon. MAH mints to your address on Alkebuleum.
                  </div>
                </div>
                <div className="shrink-0">
                  <Badge>Polygon → Alkebuleum</Badge>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    USDC amount to deposit
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={amount}
                      onChange={(e) => setAmount(clampAmountStr(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                      placeholder="10"
                      inputMode="decimal"
                    />
                    <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      USDC
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                    <div className="text-slate-500 dark:text-slate-400">Bridge fee</div>
                    <div className="text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      ${feeQuote.fee.toFixed(2)}
                    </div>

                    {/*     <div className="text-slate-500 dark:text-slate-400">You receive (est.)</div>
                    <div className="text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {feeQuote.mahNet.toFixed(6)} MAH
                    </div> */}
                  </div>

                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                      Fee details
                    </summary>
                    <div className="mt-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <div>
                        Policy: max(${UI_FEE_MIN_USD.toFixed(2)}, {(UI_FEE_BPS / 100).toFixed(2)}%) • cap ${UI_FEE_MAX_USD.toFixed(2)}
                      </div>
                      <div className="tabular-nums">
                        Net: {feeQuote.net.toFixed(6)} USDC ≈ {feeQuote.mahNet.toFixed(6)} MAH
                      </div>
                    </div>
                  </details>

                  <button
                    onClick={onDeposit}
                    disabled={!walletConnected || !address || !feeQuote.ok}
                    className="mt-3 w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Approve & Deposit
                  </button>

                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="mt-1">
                      <span className="font-semibold">POL balance:</span>{' '}
                      <span className="font-mono tabular-nums">{loadingBalances ? '…' : polBal}</span>
                    </div>
                  </div>

                  {bridgeErr && (
                    <div className="mt-3 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                      {bridgeErr}
                    </div>
                  )}
                  {bridgeInfo && (
                    <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                      {bridgeInfo}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Bridge status</div>

                  <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    <div className="flex items-center justify-between gap-2">
                      <span>BridgeVault</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{shortAddr(BRIDGEVAULT_POLY)}</span>
                        <CopyAddr value={BRIDGEVAULT_POLY} />
                      </div>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span>MAH token</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{shortAddr(MAH_ALK)}</span>
                        <CopyAddr value={MAH_ALK} />
                      </div>
                    </div>
                  </div>

                  {txHash && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">Deposit Tx</div>
                      <div className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{txHash}</div>
                    </div>
                  )}

                  {pollStatus && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                      {pollStatus}
                      {mintedTx && (
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Mint Tx: <span className="font-mono">{shortAddr(mintedTx)}</span>
                        </div>
                      )}

                      <div className="mt-3">
                        <button
                          className="text-xs text-slate-500 underline dark:text-slate-400"
                          onClick={() => setDebugOpen((v) => !v)}
                        >
                          {debugOpen ? 'Hide debug' : 'Show debug'}
                        </button>

                        {debugOpen && (
                          <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                            {lastBridgeJson || '—'}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}

                  <Link
                    to={{ pathname: '/swap', search: '?from=MAH&to=ALKE' }}
                    className="mt-3 block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    I already have MAH → Get ALKE
                  </Link>

                </div>
              </div>
            </div>
          )}

        </div>

        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {/*  Bridge API: <span className="font-mono">{BRIDGE_API}</span> */}
          {mintOpen && mintDetails && (
            <ModalShell
              title="Bridge complete — MAH received ✅"
              subtitle="Your USDC deposit has been processed and MAH is now available on Alkebuleum."
              onClose={() => setMintOpen(false)}
            >
              <div className="grid gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                  <div className="font-semibold">What happened</div>
                  <div className="mt-1">
                    MAH was minted to your Alkebuleum wallet:
                    <div className="mt-1 break-all font-mono text-xs">{address}</div>
                  </div>

                  {mintDetails.estMah && (
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Estimated received: <span className="font-semibold">{mintDetails.estMah} MAH</span>
                    </div>
                  )}
                </div>

                <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <div>
                    Deposit Tx: <span className="font-mono">{shortAddr(mintDetails.depositTx)}</span>
                  </div>
                  {mintDetails.mintTx && (
                    <div>
                      Mint Tx: <span className="font-mono">{shortAddr(mintDetails.mintTx)}</span>
                    </div>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Link
                    to={{ pathname: '/swap', search: '?from=MAH&to=ALKE' }}
                    className="rounded-xl bg-orange-600 px-4 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-orange-700"
                    onClick={() => {
                      setMintOpen(false)
                      //setStep('swap')
                    }}
                  >
                    Swap MAH → ALKE
                  </Link>

                  <button
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setMintOpen(false)}
                  >
                    Close
                  </button>
                </div>

                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  If your balance doesn’t update instantly, it may take a few seconds to refresh.
                </div>
              </div>
            </ModalShell>
          )}

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

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 9h10v10H9z" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  )
}

function CopyAddr({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 900)
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      title="Copy address"
    >
      <CopyIcon />
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</div>
            {subtitle && <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{subtitle}</div>}
          </div>
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}


function StepTab({
  active,
  n,
  title,
  subtitle,
  onClick,
}: {
  active: boolean
  n: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full sm:flex-1 rounded-2xl border px-3 py-2 text-left transition',
        active
          ? 'border-orange-300 bg-orange-50 dark:border-orange-500/30 dark:bg-orange-500/10'
          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <div
          className={[
            'grid h-7 w-7 place-items-center rounded-full text-sm font-extrabold',
            active ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
          ].join(' ')}
        >
          {n}
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{title}</div>
          <div className="truncate text-xs text-slate-600 dark:text-slate-400">{subtitle}</div>
        </div>
      </div>
    </button>
  )
}
