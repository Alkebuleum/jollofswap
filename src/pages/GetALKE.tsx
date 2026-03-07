// src/pages/GetALKE.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ethers, Interface } from 'ethers'
import { useAuth, sendTransactions } from 'amvault-connect'
import WalletSummaryCard from '../components/WalletSummaryCard'
import { useWalletMetaStore } from '../store/walletMetaStore'

type Step = 'buy' | 'bridge'

const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137) // Polygon mainnet
const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)



const POLY_RPC =
  (import.meta.env.VITE_POLY_RPC as string) ?? 'https://polygon-bor-rpc.publicnode.com'
const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'

const USDC_POLY =
  (import.meta.env.VITE_USDC_POLY as string) ?? '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'

const BRIDGEVAULT_POLY =
  (import.meta.env.VITE_BRIDGEVAULT_POLY as string) ?? '0x2b53bd82a7ad6a7ce8bf9a9d201cde639b8ae5e0'

const MAH_ALK =
  (import.meta.env.VITE_MAH_ALK as string) ?? '0x9983Cf46eeC1A7e75639eA1142410086b874dbf6'

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

const REQUIRED_CONFIRMATIONS = 10

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const ERC20_IFACE = new Interface(['function approve(address spender, uint256 amount) returns (bool)'])

const BRIDGEVAULT_IFACE = new Interface([
  'function deposit(uint256 amount, address alkRecipient) returns (bytes32)',
])

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function clampAmountStr(v: string) {
  return v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
}

export default function GetALKE() {
  const { session } = useAuth()
  const walletConnected = !!session
  const address = session?.address
  const { ain, ainLoading } = useWalletMetaStore()

  const [step, setStep] = useState<Step>('buy')

  const [usdcBal, setUsdcBal] = useState<string>('—')
  const [usdcBalNum, setUsdcBalNum] = useState<number>(0)
  const [mahBal, setMahBal] = useState<string>('—')
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [polBal, setPolBal] = useState<string>('—')

  const [amount, setAmount] = useState('10')
  const [depositing, setDepositing] = useState(false)
  const [bridgeErr, setBridgeErr] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [mintedTx, setMintedTx] = useState<string | null>(null)
  const pollingRef = useRef<number | null>(null)
  const mahBeforeRef = useRef<bigint | null>(null)
  const pollTickRef = useRef(0)

  const [lastBridgeJson, setLastBridgeJson] = useState<string>('')

  const [mintDetails, setMintDetails] = useState<{
    depositTx: string
    mintTx?: string | null
    estMah?: string | null
  } | null>(null)

  // Bridge progress dialog
  const [bridgeDialogOpen, setBridgeDialogOpen] = useState(false)
  const [bridgeDialogPhase, setBridgeDialogPhase] = useState<'confirming' | 'minting' | 'success' | 'error'>('confirming')
  const [bridgeConf, setBridgeConf] = useState(0)
  const [bridgeDialogErr, setBridgeDialogErr] = useState<string | null>(null)
  const [preBridgeBals, setPreBridgeBals] = useState<{ usdc: string; mah: string } | null>(null)

  const estMahRef = useRef<string | null>(null)

  const [transferModalOpen, setTransferModalOpen] = useState(false)
  const [coinbaseLoading, setCoinbaseLoading] = useState(false)
  const [coinbaseErr, setCoinbaseErr] = useState<string | null>(null)


  const BRIDGE_PREFLIGHT = {
    flow: 'bridge_usdc_to_mah',
    gasTopup: {
      enabled: true,
      purpose: 'jswap-bridge',
      // 0.1 POL minimum  — covers reservation up to ~189 gwei baseFee
      // 0.2 POL target   — covers reservation up to ~393 gwei baseFee
      // Faucet should give 0.2 POL so users can bridge 4–8x before needing more.
      minBalanceWei: '100000000000000000',
      targetBalanceWei: '200000000000000000',
    },
  } as any

  const [moonpayUrl, setMoonpayUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      if (!address) {
        setMoonpayUrl(null)
        return
      }

      // Use your dashboard’s Polygon-USDC currencyCode (example shown)
      const currencyCode = 'usdc_polygon'

      try {
        const r = await fetch(
          `${BRIDGE_API}/moonpay/sign?walletAddress=${encodeURIComponent(address)}&currencyCode=${encodeURIComponent(currencyCode)}`
        )
        const j = await r.json()
        if (!alive) return
        setMoonpayUrl(j?.url ?? null)
      } catch {
        if (!alive) return
        // fallback (may be ignored by MoonPay without signature)
        const params = new URLSearchParams()
        params.set('currencyCode', currencyCode)
        params.set('walletAddress', address)
        setMoonpayUrl(`${MOONPAY_BASE}?${params.toString()}`)
      }
    }

    load()
    return () => {
      alive = false
    }
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
          setUsdcBalNum(0)
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
        const fmtPol = (s: string) => {
          const n = Number(s)
          if (!Number.isFinite(n)) return s
          // Always show at least 4 decimal places so small gas amounts like 0.0050 are visible
          return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 })
        }
        setUsdcBal(fmt(usdcFmt))
        setUsdcBalNum(Number(usdcFmt))
        setMahBal(fmt(mahFmt))
        setPolBal(fmtPol(polFmt))
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
        `Fix in AmVault: route chainId ${POLY_CHAIN_ID} to a Polygon mainnet RPC.\n` +
        `After that, Approve & Deposit can be sent via AmVault without MetaMask.`
      )
    }

    if (msg.toLowerCase().includes('replacement transaction underpriced') || msg.toLowerCase().includes('replacement fee too low')) {
      return (
        `A previous transaction is still pending in the network.\n\n` +
        `This usually clears on its own within a few minutes. Please wait and try again.\n` +
        `If it keeps happening, contact support with your wallet address.`
      )
    }

    if (msg.toLowerCase().includes('insufficient funds') || msg.toLowerCase().includes('insufficient balance')) {
      return (
        `Not enough POL to pay Polygon gas.\n\n` +
        `We can *try* to top up a small amount of POL automatically, but it’s not guaranteed.\n` +
        `If the top-up fails or is unavailable:\n` +
        `• Add POL to your wallet on Polygon mainnet (chainId ${POLY_CHAIN_ID})\n` +
        `• Or try again later`
      )
    }

    if (msg.toLowerCase().includes('topup') || msg.toLowerCase().includes('faucet')) {
      return (
        `Gas top-up is temporarily unavailable.\n\n` +
        `You can still continue by adding a small amount of POL to your wallet on Polygon (chainId ${POLY_CHAIN_ID}), ` +
        `or try again later.`
      )
    }

    return e?.shortMessage || e?.message || 'Deposit failed.'
  }

  async function onBuyWithCoinbase() {
    if (!address) {
      setCoinbaseErr('Connect amVault first so Coinbase can send USDC to your wallet.')
      return
    }
    setCoinbaseLoading(true)
    setCoinbaseErr(null)
    try {
      const res = await fetch(`${BRIDGE_API}/coinbase/onramp/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          sourceAmount: '20',
          returnUrl: 'https://jollofswap.com/get-alk',
        }),
      })
      const data = await res.json().catch(() => null)
      if (!data?.ok || !data?.onrampUrl) {
        throw new Error(data?.error || 'Could not create Coinbase onramp session.')
      }
      window.location.href = data.onrampUrl
    } catch (e: any) {
      setCoinbaseErr(e?.message || 'Coinbase onramp failed. Please try again or contact support.')
    } finally {
      setCoinbaseLoading(false)
    }
  }

  async function onDeposit() {
    if (depositing) return
    setBridgeErr(null)
    setTxHash(null)
    setMintedTx(null)
    setBridgeDialogErr(null)
    setMintDetails(null)

    if (!walletConnected || !address) {
      setBridgeErr('Connect amVault using the top bar to continue.')
      return
    }

    const amtStr = clampAmountStr(amount.trim())
    if (!amtStr || Number(amtStr) <= 0) {
      setBridgeErr('Enter a valid USDC amount.')
      return
    }
    if (usdcBalNum <= 0) {
      setBridgeErr('You have no USDC on Polygon. Get USDC first (Step 1).')
      return
    }
    if (Number(amtStr) > usdcBalNum) {
      setBridgeErr(`Amount exceeds your USDC balance (${usdcBal} USDC).`)
      return
    }

    try {
      setDepositing(true)
      const usdcRead = new ethers.Contract(USDC_POLY, ERC20_ABI, polyProvider)
      const usdcDec: number = await usdcRead.decimals()
      const amt = ethers.parseUnits(amtStr, usdcDec)

      // Standard EIP-1559 gas: maxFeePerGas = 2*baseFee + priority.
      // The 2× headroom ensures the tx stays eligible even if baseFee spikes
      // over the next few blocks. Without it, txs get stuck when baseFee rises.
      // Users need ~0.2 POL (faucet amount) to cover reservation at normal–elevated prices.
      const feeData = await polyProvider.getFeeData()
      const maxFeeGwei      = Math.ceil(Number(ethers.formatUnits(feeData.maxFeePerGas      ?? 500_000_000_000n, 'gwei')))
      const maxPriorityGwei = Math.ceil(Number(ethers.formatUnits(feeData.maxPriorityFeePerGas ?? 30_000_000_000n,  'gwei')))

      const txs: Array<{
        to?: string
        data?: string
        value?: string | number | bigint
        gas?: number
        maxFeePerGasGwei?: number
        maxPriorityFeePerGasGwei?: number
      }> = []

      // Always include approve so AmVault receives a batch (2 txs).
      // A batch triggers the preflight gas top-up. A single deposit tx skips
      // preflight entirely and fails with "insufficient funds" when POL is low.
      const dataApprove = ERC20_IFACE.encodeFunctionData('approve', [BRIDGEVAULT_POLY, amt])
      txs.push({
        to: USDC_POLY,
        data: dataApprove,
        value: 0,
        gas: 65_000,   // USDC approve actual ~46k; 65k gives safe headroom
        maxFeePerGasGwei: maxFeeGwei,
        maxPriorityFeePerGasGwei: maxPriorityGwei,
      })

      const dataDeposit = BRIDGEVAULT_IFACE.encodeFunctionData('deposit', [amt, address])
      txs.push({
        to: BRIDGEVAULT_POLY,
        data: dataDeposit,
        value: 0,
        gas: 180_000,  // vault deposit actual ~100–150k; 180k gives safe headroom
        maxFeePerGasGwei: maxFeeGwei,
        maxPriorityFeePerGasGwei: maxPriorityGwei,
      })

      // Snapshot balances before AmVault opens
      setPreBridgeBals({ usdc: usdcBal, mah: mahBal })

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
      setBridgeConf(0)
      setBridgeDialogPhase('confirming')
      setBridgeDialogOpen(true)
      setDepositing(false)
      startPolling(depositHash)
    } catch (e: any) {
      console.error(e)
      setBridgeErr(normalizeAmvaultChainError(e))
      setDepositing(false)
    }
  }

  function startPolling(hash: string) {
    if (pollingRef.current) window.clearInterval(pollingRef.current)

    function completeMint(mintTxHash: string | null) {
      if (mintTxHash) setMintedTx(mintTxHash)
      const details = {
        depositTx: hash,
        mintTx: mintTxHash ?? null,
        estMah: estMahRef.current,
      }
      setMintDetails(details)
      setBridgeDialogPhase('success')
      setBridgeDialogOpen(true)
      if (pollingRef.current) window.clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    const tick = async () => {
      try {
        const url = `${BRIDGE_API}/deposits/${hash}?t=${Date.now()}`
        const res = await fetch(url, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        setLastBridgeJson(JSON.stringify(data, null, 2))

        if (!res.ok || !data?.ok) {
          // Non-fatal: keep polling
          return
        }

        const conf = Number(data?.polygon?.confirmations ?? 0)
        setBridgeConf(conf)

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
          completeMint(mintTxHash)
          return
        }

        if (conf >= REQUIRED_CONFIRMATIONS) {
          setBridgeDialogPhase('minting')
        } else {
          setBridgeDialogPhase('confirming')
        }

        pollTickRef.current += 1
        if (mahBeforeRef.current != null && pollTickRef.current % 3 === 0) {
          try {
            const mahRead = new ethers.Contract(MAH_ALK, ERC20_ABI, alkProvider)
            const now = await mahRead.balanceOf(address)
            if (now > mahBeforeRef.current) {
              completeMint(null)
              return
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // keep polling silently
      }
    }

    tick()
    pollingRef.current = window.setInterval(tick, 4000)
  }

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
          <StepTab active={step === 'buy'} n="1" title="Get USDC" subtitle="Polygon" onClick={() => setStep('buy')} />
          <StepTab active={step === 'bridge'} n="2" title="Bridge to MAH" subtitle="Alkebuleum" onClick={() => setStep('bridge')} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {step === 'buy' && (
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Step 1 — Get USDC on Polygon
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Buy USDC directly or transfer from an existing wallet, then bridge to MAH.
                  </div>
                </div>
                <div className="shrink-0">
                  <Badge>Network: Polygon</Badge>
                </div>
              </div>

              {/* Two option cards */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">

                {/* --- Buy with Stripe --- */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100">Buy USDC</div>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                        Coinbase
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                      Buy USDC with a card or bank transfer via Coinbase Pay. USDC is sent directly to your connected wallet on Polygon.
                    </p>
                  </div>
                  {coinbaseErr && (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                      {coinbaseErr}
                    </div>
                  )}
                  <button
                    onClick={onBuyWithCoinbase}
                    disabled={coinbaseLoading || !address}
                    className="mt-3 w-full rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {coinbaseLoading ? 'Opening…' : 'Buy USDC →'}
                  </button>
                </div>

                {/* --- Transfer from external wallet --- */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Transfer from external wallet
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                      Already have USDC on Binance, Coinbase, or another wallet? Send it directly to your JollofSwap address on Polygon.
                    </p>
                  </div>
                  <button
                    onClick={() => setTransferModalOpen(true)}
                    className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    How to transfer →
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <button
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                  onClick={() => setStep('bridge')}
                >
                  I have USDC on Polygon → Continue to Bridge
                </button>
              </div>
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
                    disabled={
                      !walletConnected ||
                      !address ||
                      !feeQuote.ok ||
                      depositing ||
                      (!loadingBalances && usdcBalNum <= 0) ||
                      (!loadingBalances && feeQuote.amt > usdcBalNum)
                    }
                    className="mt-3 w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {depositing
                      ? 'Preparing…'
                      : !loadingBalances && walletConnected && usdcBalNum <= 0
                      ? 'No USDC balance'
                      : !loadingBalances && walletConnected && feeQuote.amt > usdcBalNum
                      ? 'Amount exceeds balance'
                      : 'Approve & Deposit'}
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
                  {txHash && !bridgeDialogOpen && (
                    <button
                      onClick={() => setBridgeDialogOpen(true)}
                      className="mt-3 w-full rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-800 transition hover:bg-orange-100 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200 dark:hover:bg-orange-500/20"
                    >
                      View bridge status →
                    </button>
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

                  <Link
                    to={{ pathname: '/swap', search: '?from=MAH&to=ALKE' }}
                    className="mt-3 block w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-center font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                  >
                    I already have MAH → Get ALKE
                  </Link>

                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Transfer from external wallet modal */}
      {transferModalOpen && (
        <ModalShell
          title="Transfer USDC from external wallet"
          subtitle="Send USDC on Polygon to your JollofSwap address."
          onClose={() => setTransferModalOpen(false)}
        >
          <div className="grid gap-4">

            {/* Critical warning */}
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
                Read before you send
              </div>
              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-amber-800 dark:text-amber-300">
                <li>
                  You must send on the <span className="font-semibold">Polygon network</span> — not Ethereum, not BNB Chain, not any other chain.
                </li>
                <li>
                  Send to the <span className="font-semibold">exact wallet address you connected to JollofSwap with</span> (shown below). That is the address that will receive MAH after bridging.
                </li>
                <li>
                  Sending from a different address means MAH is minted to that other address — <span className="font-semibold">not your JollofSwap wallet</span>.
                </li>
              </ul>
            </div>

            {/* Wallet address */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Your wallet address — send USDC here on Polygon
              </div>
              {address ? (
                <div className="mt-2 flex items-start gap-3">
                  <span className="break-all font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {address}
                  </span>
                  <div className="shrink-0">
                    <CopyAddr value={address} />
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  Connect amVault (top bar) to see your address.
                </div>
              )}
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Paste this as the destination address in your exchange or wallet. Always select Polygon as the network.
              </div>
            </div>

            {/* Steps */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                How to send USDC from an exchange
              </div>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-400">
                <li>Log in to your exchange or wallet (Binance, Coinbase, Kraken, OKX, Bybit, etc.).</li>
                <li>Go to Withdraw → USDC and select <span className="font-semibold text-slate-800 dark:text-slate-200">Polygon</span> as the network.</li>
                <li>Paste your address above as the destination. Double-check it before confirming.</li>
                <li>Wait for USDC to arrive (usually 1–5 minutes), then close this and click <span className="font-semibold text-slate-800 dark:text-slate-200">Continue to Bridge</span>.</li>
              </ol>
            </div>

            <button
              className="w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700"
              onClick={() => { setTransferModalOpen(false); setStep('bridge') }}
            >
              I've sent USDC → Continue to Bridge
            </button>
          </div>
        </ModalShell>
      )}

      {bridgeDialogOpen && (
        <BridgeProgressModal
          phase={bridgeDialogPhase}
          conf={bridgeConf}
          required={REQUIRED_CONFIRMATIONS}
          txHash={txHash}
          mintDetails={mintDetails}
          error={bridgeDialogErr}
          address={address}
          usdcBal={usdcBal}
          mahBal={mahBal}
          preBridgeBals={preBridgeBals}
          onClose={() => setBridgeDialogOpen(false)}
        />
      )}
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


function BridgeProgressModal({
  phase,
  conf,
  required,
  txHash,
  mintDetails,
  error,
  address,
  usdcBal,
  mahBal,
  preBridgeBals,
  onClose,
}: {
  phase: 'confirming' | 'minting' | 'success' | 'error'
  conf: number
  required: number
  txHash: string | null
  mintDetails: { depositTx: string; mintTx?: string | null; estMah?: string | null } | null
  error: string | null
  address?: string
  usdcBal: string
  mahBal: string
  preBridgeBals: { usdc: string; mah: string } | null
  onClose: () => void
}) {
  const isDone = phase === 'success'
  const isError = phase === 'error'
  const isActive = !isDone && !isError

  const steps: Array<{ label: string; sublabel?: string; done: boolean; active: boolean }> = [
    {
      label: 'Deposit submitted',
      sublabel: txHash ? `${txHash.slice(0, 10)}…${txHash.slice(-6)}` : undefined,
      done: true,
      active: false,
    },
    {
      label: 'Awaiting confirmations',
      sublabel:
        phase === 'confirming'
          ? `${conf} / ${required}`
          : `${required} / ${required}`,
      done: phase !== 'confirming',
      active: phase === 'confirming',
    },
    {
      label: 'Bridge processing',
      sublabel: phase === 'minting' ? 'Minting MAH on Alkebuleum…' : undefined,
      done: isDone,
      active: phase === 'minting',
    },
    {
      label: 'MAH received',
      sublabel: mintDetails?.estMah ? `≈ ${mintDetails.estMah} MAH` : undefined,
      done: isDone,
      active: false,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" style={{ maxHeight: '90vh' }}>

        {/* Header band */}
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
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {isDone ? 'Bridge complete' : isError ? 'Bridge failed' : 'Bridging in progress'}
              </div>
              <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                {isDone
                  ? 'MAH has been minted to your wallet.'
                  : isError
                  ? 'Something went wrong — see details below.'
                  : 'USDC (Polygon) → MAH (Alkebuleum)'}
              </div>
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

        <div className="flex-1 space-y-5 overflow-y-auto p-5">

          {/* Step list — hide on error */}
          {!isError && (
            <div>
              {steps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  {/* Circle + connector line */}
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
                      ) : (
                        <span>{i + 1}</span>
                      )}
                    </div>
                    {i < steps.length - 1 && (
                      <div
                        className={[
                          'my-1 w-0.5 flex-1',
                          step.done ? 'bg-green-400' : 'bg-slate-200 dark:bg-slate-700',
                        ].join(' ')}
                        style={{ minHeight: 20 }}
                      />
                    )}
                  </div>

                  {/* Step content */}
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
                    {/* Confirmation progress bar */}
                    {step.active && phase === 'confirming' && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full bg-orange-500 transition-all duration-700"
                          style={{ width: `${Math.min(100, (conf / required) * 100)}%` }}
                        />
                      </div>
                    )}
                    {/* Animated dots for minting */}
                    {step.active && phase === 'minting' && (
                      <div className="mt-2 flex gap-1">
                        {[0, 1, 2].map((j) => (
                          <div
                            key={j}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400"
                            style={{ animationDelay: `${j * 0.15}s` }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error panel */}
          {isError && error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/30">
              <div className="mb-1 text-sm font-semibold text-red-700 dark:text-red-400">Error</div>
              <div className="whitespace-pre-wrap text-sm text-red-600 dark:text-red-300">{error}</div>
            </div>
          )}

          {/* Live balances */}
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
              {/* USDC — goes down */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500 dark:text-slate-400">USDC (Polygon)</div>
                <div className={[
                  'mt-1 text-lg font-bold tabular-nums',
                  isDone ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100',
                ].join(' ')}>
                  {usdcBal}
                </div>
                {isDone && preBridgeBals && preBridgeBals.usdc !== usdcBal && (
                  <div className="mt-0.5 text-xs text-slate-400 line-through dark:text-slate-500">
                    {preBridgeBals.usdc}
                  </div>
                )}
              </div>

              {/* MAH — goes up */}
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs text-slate-500 dark:text-slate-400">MAH (Alkebuleum)</div>
                <div className={[
                  'mt-1 text-lg font-bold tabular-nums',
                  isDone ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100',
                ].join(' ')}>
                  {mahBal}
                </div>
                {isDone && preBridgeBals && preBridgeBals.mah !== mahBal && (
                  <div className="mt-0.5 text-xs text-slate-400 line-through dark:text-slate-500">
                    {preBridgeBals.mah}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Success details */}
          {isDone && mintDetails && (
            <div className="space-y-3">
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-900/40 dark:bg-green-950/20">
                <div className="text-sm font-semibold text-green-800 dark:text-green-300">
                  MAH minted to your wallet
                </div>
                {address && (
                  <div className="mt-1 break-all font-mono text-xs text-green-700 dark:text-green-400">
                    {address}
                  </div>
                )}
                {mintDetails.estMah && (
                  <div className="mt-1.5 text-xs text-green-700 dark:text-green-400">
                    Estimated received:{' '}
                    <span className="font-semibold">{mintDetails.estMah} MAH</span>
                  </div>
                )}
              </div>
              <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <div>
                  Deposit Tx:{' '}
                  <span className="font-mono">{shortAddr(mintDetails.depositTx)}</span>
                </div>
                {mintDetails.mintTx && (
                  <div>
                    Mint Tx:{' '}
                    <span className="font-mono">{shortAddr(mintDetails.mintTx)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          {isDone && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Link
                to={{ pathname: '/swap', search: '?from=MAH&to=ALKE' }}
                className="rounded-xl bg-orange-600 px-4 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-orange-700"
                onClick={onClose}
              >
                Swap MAH to ALKE
              </Link>
              <button
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          )}
          {isError && (
            <button
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              onClick={onClose}
            >
              Dismiss
            </button>
          )}

          {/* Active hint */}
          {isActive && (
            <div className="text-center text-xs text-slate-400 dark:text-slate-600">
              Keep this window open. Bridging usually completes in 1–3 minutes.
            </div>
          )}
        </div>
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
