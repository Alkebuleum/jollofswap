// src/pages/Tokens.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ethers, Interface } from 'ethers'
import { useAuth, sendTransactions } from 'amvault-connect'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../services/firebase'

const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)
const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'
const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

// Deploy contract (factory)
const TOKEN_FACTORY_ALK = (import.meta.env.VITE_TOKEN_FACTORY_ALK as string) ?? ''
const ALK_EXPLORER = (import.meta.env.VITE_ALK_EXPLORER as string) ?? ''

// ✅ Use existing faucet backend (same Firebase)
const FAUCET_API = (import.meta.env.VITE_FAUCET_API as string) ?? 'https://faucet.alkebuleum.com/api'

// ✅ Paid registry settings
const REGISTRY_TREASURY_ALK = (import.meta.env.VITE_REGISTRY_TREASURY_ALK as string) ?? ''
const REGISTRY_FEE_AKE = Number(import.meta.env.VITE_REGISTRY_FEE_AKE ?? 2000)
const REGISTRY_MIN_CONFS = Number(import.meta.env.VITE_REGISTRY_MIN_CONFS ?? 2)
const ALK_GAS_PRICE_GWEI = Number(import.meta.env.VITE_ALK_GAS_PRICE_GWEI ?? 0)

const ENABLE_TOKEN_CREATE = String(import.meta.env.VITE_ENABLE_TOKEN_CREATE ?? '0') === '1'

type TokenRow = {
  chainId: number
  address: string
  addressLower?: string
  symbol: string
  name: string
  decimals: number

  // registry fields (from Firestore)
  description?: string
  logoUrl?: string
  website?: string

  status?: string
  creator?: string
  owner?: string
  createTxHash?: string
  createdAtMs?: number
  isNative?: boolean
}

function shortAddr(a?: string) {
  if (!a) return ''
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function clampAmountStr(v: string) {
  return v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
}

function upperSym(v: string) {
  return v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 11)
}

function safeTrim(v: string) {
  return (v ?? '').trim()
}

function normalizeUrl(v: string) {
  const s = safeTrim(v)
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) return `https://${s}`
  return s
}

function isMaybeUrl(v: string) {
  const s = safeTrim(v)
  if (!s) return true
  try {
    const u = new URL(normalizeUrl(s))
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function fmtInt(n: number) {
  if (!Number.isFinite(n)) return String(n)
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

/* ---------------- amVault tx normalization (no BigInt) ---------------- */

function hexValue(v: any): string {
  if (v == null) return '0x0'
  if (typeof v === 'bigint') return ethers.toBeHex(v)
  if (typeof v === 'number') return ethers.toBeHex(BigInt(v))
  if (typeof v === 'string') return v
  return '0x0'
}

function normalizeTxForAmVault(tx: any) {
  const out: any = { ...tx }

  // value -> hex string (never BigInt)
  out.value = hexValue(out?.value ?? 0)

  const defaultGasPriceGwei = ALK_GAS_PRICE_GWEI > 0 ? ALK_GAS_PRICE_GWEI : 5
  const defaultGasPrice = BigInt(defaultGasPriceGwei) * 1_000_000_000n

  // gasLimit / gas
  if (out.gasLimit == null && out.gas == null) out.gasLimit = 250_000
  if (typeof out.gasLimit === 'bigint') out.gasLimit = Number(out.gasLimit)
  if (out.gas == null) out.gas = out.gasLimit
  if (typeof out.gas === 'bigint') out.gas = Number(out.gas)

  // gasPrice -> hex
  out.gasPrice = hexValue(out.gasPrice ?? defaultGasPrice)

  // force legacy type 0 on Besu
  out.type = 0

  return out
}

/* ---------------- Factory interface ---------------- */

const FACTORY_IFACE = new Interface([
  'function createToken(string name,string symbol,uint256 initialSupply,address owner) returns (address)',
  'event TokenCreated(address indexed token,address indexed creator,address indexed owner,string name,string symbol,uint8 decimals,uint256 initialSupply)',
])

export default function Tokens() {
  const { session } = useAuth()
  const walletConnected = !!session
  const address = session?.address

  const alkProvider = useMemo(() => new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID), [])

  // directory
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Create Token modal
  const [createOpen, setCreateOpen] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployErr, setDeployErr] = useState<string | null>(null)
  const [deployInfo, setDeployInfo] = useState<string | null>(null)

  const [tName, setTName] = useState('')
  const [tSymbol, setTSymbol] = useState('')
  const [tSupply, setTSupply] = useState('1000000')
  const [tOwner, setTOwner] = useState('')

  const [createdTokenAddr, setCreatedTokenAddr] = useState<string | null>(null)
  const closeCreateBtnRef = useRef<HTMLButtonElement | null>(null)

  // Register Token (paid listing) modal
  const [regOpen, setRegOpen] = useState(false)
  const [regBusy, setRegBusy] = useState(false)
  const [regErr, setRegErr] = useState<string | null>(null)
  const [regInfo, setRegInfo] = useState<string | null>(null)
  const [regPayTx, setRegPayTx] = useState<string | null>(null)

  const [rAddress, setRAddress] = useState('')
  const [rName, setRName] = useState('')
  const [rSymbol, setRSymbol] = useState('')
  const [rDesc, setRDesc] = useState('')
  const [rLogoUrl, setRLogoUrl] = useState('')
  const [rWebsite, setRWebsite] = useState('')

  const regPollRef = useRef<number | null>(null)

  const factoryReady = useMemo(
    () => TOKEN_FACTORY_ALK && ethers.isAddress(TOKEN_FACTORY_ALK),
    [TOKEN_FACTORY_ALK]
  )

  const CREATE_PREFLIGHT = {
    flow: 'token_create_v1',
    gasTopup: { enabled: true, purpose: 'jswap-token-create' },
  } as any

  const REG_PAY_PREFLIGHT = {
    flow: 'token_register_pay_v1',
    gasTopup: { enabled: true, purpose: 'jswap-token-register' },
  } as any

  // Load tokens from Firestore
  useEffect(() => {
    setLoading(true)
    setErr(null)

    const q = query(collection(db, 'tokens'), orderBy('createdAtMs', 'desc'), limit(300))

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: TokenRow[] = []
        snap.forEach((d) => rows.push(d.data() as TokenRow))
        setTokens(rows.filter((r) => r.chainId === ALK_CHAIN_ID))
        setLoading(false)
      },
      (e) => {
        console.error(e)
        setErr(e?.message || 'Failed to load tokens')
        setLoading(false)
      }
    )

    return () => unsub()
  }, [])

  // default owner = connected wallet
  useEffect(() => {
    if (!createOpen) return
    if (address) setTOwner(address)
  }, [createOpen, address])

  // stop reg polling on unmount
  useEffect(() => {
    return () => {
      if (regPollRef.current) window.clearInterval(regPollRef.current)
      regPollRef.current = null
    }
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return tokens
    return tokens.filter((t) => {
      const hay = `${t.symbol} ${t.name} ${t.address} ${t.description ?? ''} ${t.website ?? ''}`.toLowerCase()
      return hay.includes(s)
    })
  }, [tokens, search])

  /* ---------------- Create Token ---------------- */

  function resetCreateForm() {
    setTName('')
    setTSymbol('')
    setTSupply('1000000')
    setTOwner(address ?? '')
    setDeployErr(null)
    setDeployInfo(null)
    setCreatedTokenAddr(null)
  }

  function openCreateModal() {
    resetCreateForm()
    setCreateOpen(true)
    setTimeout(() => closeCreateBtnRef.current?.focus(), 0)
  }

  function validateCreate(): string | null {
    if (!walletConnected || !address) return 'Connect amVault to create a token.'
    if (!factoryReady) return 'Token Factory is not configured yet.'
    const n = safeTrim(tName)
    const s = upperSym(safeTrim(tSymbol))
    const o = safeTrim(tOwner)
    const sup = clampAmountStr(safeTrim(tSupply))

    if (n.length < 2) return 'Token name is too short.'
    if (s.length < 2) return 'Symbol must be at least 2 characters.'
    if (!ethers.isAddress(o)) return 'Owner address is invalid.'
    if (!sup || Number(sup) <= 0) return 'Initial supply must be greater than 0.'
    return null
  }

  async function onDeploy() {
    setDeployErr(null)
    setDeployInfo(null)
    setCreatedTokenAddr(null)

    const v = validateCreate()
    if (v) {
      setDeployErr(v)
      return
    }

    try {
      setDeploying(true)

      const name = safeTrim(tName)
      const symbol = upperSym(safeTrim(tSymbol))
      const owner = safeTrim(tOwner)
      const supplyStr = clampAmountStr(safeTrim(tSupply))
      const initialSupply = ethers.parseUnits(supplyStr, 18)

      const data = FACTORY_IFACE.encodeFunctionData('createToken', [name, symbol, initialSupply, owner])

      setDeployInfo('Deploy queued. Confirm in amVault…')

      const rawTxs = [{ to: TOKEN_FACTORY_ALK, data, value: 0n, gasLimit: 2_200_000 }]
      const txs = rawTxs.map(normalizeTxForAmVault)

      const results = await sendTransactions(
        {
          chainId: ALK_CHAIN_ID,
          txs,
          failFast: true,
          preflight: CREATE_PREFLIGHT,
        } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = results?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Transaction failed')

      const txHash = results?.[0]?.txHash
      if (!txHash) throw new Error('No txHash returned from amVault')

      setDeployInfo('Deploy sent. Waiting for confirmation…')

      const receipt = await alkProvider.waitForTransaction(txHash, 1)
      if (!receipt) throw new Error('No receipt yet (try again).')

      let tokenAddr: string | null = null
      for (const log of receipt.logs) {
        try {
          const parsed = FACTORY_IFACE.parseLog(log as any)
          if (parsed?.name === 'TokenCreated') {
            tokenAddr = parsed.args?.token
            break
          }
        } catch { }
      }

      if (!tokenAddr || !ethers.isAddress(tokenAddr)) {
        setDeployInfo(
          `Deploy confirmed ✅\n\nToken address was not detected from logs.\nOpen explorer for the tx and copy the TokenCreated token address.`
        )
        return
      }

      const addr = ethers.getAddress(tokenAddr)
      setCreatedTokenAddr(addr)

      setDeployInfo(
        `Token created ✅\n\n` +
        `Token Address:\n${addr}\n\n` +
        `IMPORTANT: Copy + save this address.\n` +
        `If you lose it, you may not be able to register/list your token later.`
      )
    } catch (e: any) {
      console.error(e)
      setDeployErr(e?.shortMessage || e?.message || 'Deploy failed.')
      setDeployInfo(null)
    } finally {
      setDeploying(false)
    }
  }

  /* ---------------- Register Token (Paid listing) ---------------- */

  function openRegisterModal() {
    setRegErr(null)
    setRegInfo(null)
    setRegPayTx(null)

    if (createdTokenAddr) setRAddress(createdTokenAddr)
    if (safeTrim(tName)) setRName(safeTrim(tName))
    if (safeTrim(tSymbol)) setRSymbol(upperSym(safeTrim(tSymbol)))

    setRegOpen(true)
  }

  function validateRegister(): string | null {
    if (!walletConnected || !address) return 'Connect amVault first.'
    const a = safeTrim(rAddress)
    if (!ethers.isAddress(a)) return 'Token address is invalid.'
    const nm = safeTrim(rName)
    const sy = upperSym(safeTrim(rSymbol))
    if (nm.length < 2) return 'Token name is too short.'
    if (sy.length < 2) return 'Symbol must be at least 2 characters.'
    if (!isMaybeUrl(rLogoUrl)) return 'Logo URL must be a valid URL.'
    if (!isMaybeUrl(rWebsite)) return 'Website must be a valid URL.'
    return null
  }

  async function callRegisterApi(paymentTxHash: string) {
    const payload = {
      paymentTxHash,
      tokenAddress: ethers.getAddress(safeTrim(rAddress)),
      ownerWallet: ethers.getAddress(address!),
      token: {
        name: safeTrim(rName),
        symbol: upperSym(safeTrim(rSymbol)),
        decimals: 18,
        description: safeTrim(rDesc),
        logoUrl: normalizeUrl(rLogoUrl),
        website: normalizeUrl(rWebsite),
      },
    }

    const res = await fetch(`${FAUCET_API.replace(/\/$/, '')}/tokens/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json().catch(() => null)
    return { res, data }
  }

  function closeRegisterModal() {
    if (regPollRef.current) window.clearInterval(regPollRef.current)
    regPollRef.current = null
    setRegBusy(false)
    setRegOpen(false)
  }

  function startRegPolling(paymentTxHash: string) {
    if (regPollRef.current) window.clearInterval(regPollRef.current)

    const tick = async () => {
      try {
        const { res, data } = await callRegisterApi(paymentTxHash)

        if (res.status === 202 && data?.pending) {
          const conf = Number(data?.confirmations ?? 0)
          const req = Number(data?.required ?? REGISTRY_MIN_CONFS)
          setRegInfo(`Payment confirmed ${conf}/${req}… registering…`)
          return
        }

        if (!res.ok || !data?.ok) {
          const msg = data?.error || res.statusText || 'Registration failed.'
          setRegErr(msg)
          setRegInfo(null)
          if (regPollRef.current) window.clearInterval(regPollRef.current)
          regPollRef.current = null
          setRegBusy(false) // ✅ unlock on error
          return
        }

        setRegInfo('Registered ✅ Your token will appear in the directory shortly.')
        setRegErr(null)

        if (regPollRef.current) window.clearInterval(regPollRef.current)
        regPollRef.current = null

        setRegBusy(false) // ✅ unlock on success
        setTimeout(() => setRegOpen(false), 700)
      } catch {
        // keep polling quietly
      }
    }

    tick()
    regPollRef.current = window.setInterval(tick, 4000)
  }

  async function onRegisterPaid() {
    if (regBusy) return

    setRegErr(null)
    setRegInfo(null)
    setRegPayTx(null)

    const v = validateRegister()
    if (v) {
      setRegErr(v)
      return
    }

    if (!REGISTRY_TREASURY_ALK || !ethers.isAddress(REGISTRY_TREASURY_ALK)) {
      setRegErr('Registry treasury is not configured (VITE_REGISTRY_TREASURY_ALK).')
      return
    }

    try {
      setRegBusy(true)

      setRegInfo(`Fee: ${fmtInt(REGISTRY_FEE_AKE)} AKE — confirm payment in amVault…`)
      const feeWei = ethers.parseEther(String(REGISTRY_FEE_AKE)) // AKE has 18 decimals

      const rawTxs = [{ to: REGISTRY_TREASURY_ALK, value: feeWei, gasLimit: 80_000 }]
      const txs = rawTxs.map(normalizeTxForAmVault)

      const payRes = await sendTransactions(
        {
          chainId: ALK_CHAIN_ID,
          txs,
          failFast: true,
          preflight: REG_PAY_PREFLIGHT,
        } as any,
        { app: APP_NAME, amvaultUrl: AMVAULT_URL }
      )

      const firstFail = payRes?.find((r: any) => r?.ok === false)
      if (firstFail) throw new Error(firstFail.error || 'Payment failed')

      const paymentTxHash = payRes?.[0]?.txHash
      if (!paymentTxHash) throw new Error('No payment txHash returned from amVault')

      setRegPayTx(paymentTxHash)
      setRegInfo('Payment sent ✅ Verifying & registering…')

      await alkProvider.waitForTransaction(paymentTxHash, 1).catch(() => null)

      startRegPolling(paymentTxHash)
    } catch (e: any) {
      setRegErr(e?.shortMessage || e?.message || 'Registration failed.')
      setRegInfo(null)
      setRegBusy(false)
    }
  }

  /* ---------------- UI ---------------- */

  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        {/* Header */}
        <div className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">Tokens</h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Token directory + token factory (V1).</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={openRegisterModal}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Register
              </button>
              <button
                onClick={openCreateModal}
                disabled={!ENABLE_TOKEN_CREATE}
                title={!ENABLE_TOKEN_CREATE ? 'Token creation is limited in this build' : 'Create token'}
                className={[
                  'rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700',
                  !ENABLE_TOKEN_CREATE ? 'cursor-not-allowed opacity-40 hover:bg-orange-600' : '',
                ].join(' ')}
              >
                Create
              </button>
            </div>
          </div>

          <div className="mt-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol, name, address…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-orange-500/20"
            />
          </div>
        </div>

        {/* Factory */}
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Token Factory</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Deploy ERC-20 (18 decimals). Register to list it in the directory (paid).
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge>V1</Badge>
              <Badge>Chain {ALK_CHAIN_ID}</Badge>
              <Badge>Fee {fmtInt(REGISTRY_FEE_AKE)} AKE</Badge>
            </div>
          </div>

          {!factoryReady && (
            <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
              Factory not configured yet. Set <span className="font-mono">VITE_TOKEN_FACTORY_ALK</span>.
            </div>
          )}

          {!walletConnected && (
            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Connect amVault using the top bar to create/register tokens.
            </div>
          )}

          {createdTokenAddr && (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">New token address</div>
                  <div className="mt-1 break-all font-mono text-xs text-slate-700 dark:text-slate-200">
                    {createdTokenAddr}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Copy this address. You’ll need it to register/list the token.
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    onClick={() => navigator.clipboard.writeText(createdTokenAddr)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    Copy
                  </button>
                  <button
                    onClick={openRegisterModal}
                    className="rounded-xl bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
                  >
                    Register
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Directory */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">Directory</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {loading ? 'Loading…' : `${filtered.length} token(s)`}
            </div>
          </div>

          {err && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {err}
            </div>
          )}

          {!err && !loading && filtered.length === 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
              No tokens found yet.
            </div>
          )}

          <div className="mt-4 grid gap-4 grid-cols-1">
            {filtered.map((t) => (
              <TokenCard key={`${t.chainId}:${t.address}`} t={t} explorerBase={ALK_EXPLORER} />
            ))}
          </div>
        </div>

        {/* ---------------- Create Token Modal ---------------- */}
        {createOpen && (
          <ModalShell
            onClose={() => setCreateOpen(false)}
            title="Create Token"
            subtitle="V1: Basic ERC-20 with 18 decimals."
            closeBtnRef={closeCreateBtnRef}
          >
            <div className="grid gap-3">
              <Field label="Token Name">
                <input
                  value={tName}
                  onChange={(e) => setTName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                  placeholder="e.g. My Community Token"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Symbol">
                  <input
                    value={tSymbol}
                    onChange={(e) => setTSymbol(upperSym(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="e.g. MCT"
                  />
                </Field>

                <Field label="Decimals">
                  <input
                    value="18"
                    readOnly
                    className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                  />
                </Field>
              </div>

              <Field label="Initial Supply (whole tokens)">
                <input
                  value={tSupply}
                  onChange={(e) => setTSupply(clampAmountStr(e.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                  placeholder="1000000"
                  inputMode="decimal"
                />
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Supply is minted to the owner. Stored on-chain with 18 decimals.
                </div>
              </Field>

              <Field label="Owner / Admin Address">
                <input
                  value={tOwner}
                  onChange={(e) => setTOwner(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                  placeholder={address ?? '0x...'}
                />
              </Field>

              {deployErr && (
                <div className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  {deployErr}
                </div>
              )}
              {deployInfo && (
                <div className="whitespace-pre-wrap rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
                  {deployInfo}
                </div>
              )}

              <button
                onClick={onDeploy}
                disabled={!walletConnected || deploying || !factoryReady}
                className="mt-1 w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deploying ? 'Deploying…' : 'Deploy Token'}
              </button>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                After deploy, copy the token address and use <span className="font-semibold">Register Token</span> to list it (paid).
              </div>
            </div>
          </ModalShell>
        )}

        {/* ---------------- Register Token Modal ---------------- */}
        {regOpen && (
          <ModalShell
            onClose={closeRegisterModal}
            title="Register Token"
            subtitle="List your token in the directory so apps can fetch metadata from one canonical source."
          >
            <div className="grid gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                <div className="font-semibold">Registration fee</div>
                <div className="mt-1">
                  <span className="font-semibold">{fmtInt(REGISTRY_FEE_AKE)} AKE</span> (paid on Alkebuleum)
                </div>
              </div>

              <Field label="Token Contract Address">
                <input
                  value={rAddress}
                  onChange={(e) => setRAddress(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                  placeholder="0x..."
                />
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  If you lose your token address, you may not be able to register it later.
                </div>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    value={rName}
                    onChange={(e) => setRName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="Token name"
                  />
                </Field>

                <Field label="Symbol">
                  <input
                    value={rSymbol}
                    onChange={(e) => setRSymbol(upperSym(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="SYMBOL"
                  />
                </Field>
              </div>

              <Field label="Description (optional)">
                <textarea
                  value={rDesc}
                  onChange={(e) => setRDesc(e.target.value)}
                  className="min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                  placeholder="Short description of the token utility"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Logo URL (optional)">
                  <input
                    value={rLogoUrl}
                    onChange={(e) => setRLogoUrl(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="https://.../logo.png"
                  />
                </Field>

                <Field label="Website (optional)">
                  <input
                    value={rWebsite}
                    onChange={(e) => setRWebsite(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-orange-500/20"
                    placeholder="https://example.com"
                  />
                </Field>
              </div>

              {regErr && (
                <div className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                  {regErr}
                </div>
              )}
              {regInfo && (
                <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                  {regInfo}
                  {regPayTx && (
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Payment Tx: <span className="font-mono">{shortAddr(regPayTx)}</span>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={onRegisterPaid}
                disabled={!walletConnected || regBusy}
                className="mt-1 w-full rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {regBusy ? 'Processing…' : `Pay ${fmtInt(REGISTRY_FEE_AKE)} AKE & Register`}
              </button>

              <div className="text-xs text-slate-500 dark:text-slate-400">
                We verify your payment on-chain (min {REGISTRY_MIN_CONFS} confirmations), then add your token to the directory.
              </div>
            </div>
          </ModalShell>
        )}
      </div>
    </div>
  )
}

/* ---------------- UI Components ---------------- */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
      {children}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function ModalShell({
  title,
  subtitle,
  onClose,
  closeBtnRef,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  closeBtnRef?: React.RefObject<HTMLButtonElement | null>
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
            ref={closeBtnRef as any}
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

function TokenCard({ t, explorerBase }: { t: TokenRow; explorerBase: string }) {
  const canExplorer = !!explorerBase
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
  const isNative = !!t.isNative || (t.address || '').toLowerCase() === ZERO_ADDR

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-orange-100 bg-orange-50 dark:border-orange-500/20 dark:bg-orange-500/10">
              {t.logoUrl ? (
                <img src={t.logoUrl} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-extrabold text-orange-700 dark:text-orange-300">
                  {(t.symbol || '?').slice(0, 2)}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-lg font-extrabold text-slate-900 dark:text-slate-100">{t.symbol}</div>
                <Badge>{t.status || 'Registered'}</Badge>
              </div>
              <div className="truncate text-sm text-slate-700 dark:text-slate-300">{t.name}</div>
              {t.description && (
                <div className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">
                  {t.description}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {isNative ? (
              <span className="font-semibold text-slate-700 dark:text-slate-200">Native asset (no contract address)</span>
            ) : (
              <>
                Address: <span className="font-mono text-slate-700 dark:text-slate-200">{shortAddr(t.address)}</span>
              </>
            )}
          </div>

          {t.website && (
            <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
              Website:{' '}
              <a className="underline" href={t.website} target="_blank" rel="noreferrer">
                {t.website}
              </a>
            </div>
          )}
        </div>

        <div className="text-right">
          <div className="text-xs text-slate-500 dark:text-slate-400">Decimals</div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.decimals}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="/swap"
          className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700"
        >
          Swap
        </a>

        {!isNative && (
          <>
            <button
              onClick={() => navigator.clipboard.writeText(t.address)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Copy Address
            </button>

            {canExplorer && (
              <a
                href={`${explorerBase.replace(/\/$/, '')}/address/${t.address}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                View
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}
