// src/pages/Tokens.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ethers, Interface } from 'ethers'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useSignerSession } from '../hooks/useSignerSession'
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth, db, signInAdmin } from '../services/firebase'
import { ensureFirebaseGuest } from '../services/firebaseGuest'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { isAdminAin } from '../lib/admin'
import { Link } from 'react-router-dom'

const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)
const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'
const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'
const TOKEN_FACTORY_ALK = (import.meta.env.VITE_TOKEN_FACTORY_ALK as string) ?? ''
const ALK_EXPLORER = (import.meta.env.VITE_ALK_EXPLORER as string) ?? ''
const FAUCET_API = (import.meta.env.VITE_FAUCET_API as string) ?? 'https://faucet.alkebuleum.com/api'
const REGISTRY_TREASURY_ALK = (import.meta.env.VITE_REGISTRY_TREASURY_ALK as string) ?? ''
const REGISTRY_FEE_AKE = Number(import.meta.env.VITE_REGISTRY_FEE_AKE ?? 2000)
const REGISTRY_MIN_CONFS = Number(import.meta.env.VITE_REGISTRY_MIN_CONFS ?? 2)
const ALK_GAS_PRICE_GWEI = Number(import.meta.env.VITE_ALK_GAS_PRICE_GWEI ?? 0)
const ENABLE_TOKEN_CREATE = String(import.meta.env.VITE_ENABLE_TOKEN_CREATE ?? '0') === '1'
// The app signs everyone into this shared low-privilege account for routine
// Firestore access (see services/firebaseGuest.ts). onAuthStateChanged fires
// for that session too, so "some Firebase user is signed in" alone can't be
// treated as "the admin is signed in" — it must be a different account.
const GUEST_EMAIL = ((import.meta.env.VITE_FB_GUEST_EMAIL as string) ?? '').trim().toLowerCase()

type TokenRow = {
  id?: string
  chainId: number; address: string; addressLower?: string
  symbol: string; name: string; decimals: number
  description?: string; logoUrl?: string; website?: string
  status?: string; creator?: string; owner?: string; ownerAin?: string
  createTxHash?: string; createdAtMs?: number; isNative?: boolean
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

function shortAddr(a?: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '' }
function clampAmountStr(v: string) { return v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') }
function upperSym(v: string) { return v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 11) }
function safeTrim(v: string) { return (v ?? '').trim() }
// A single leading slash is a root-relative local asset path (e.g. /mahlogo.png)
// and is left as-is. Two or more is a protocol-relative URL (e.g. //evil.com,
// which browsers resolve to https://evil.com) — reject it outright rather than
// let it slip through as "valid" on the Website field.
function normalizeUrl(v: string) { const s = safeTrim(v); if (!s) return ''; if (s.startsWith('//')) return ''; if (s.startsWith('/')) return s; return /^https?:\/\//i.test(s) ? s : `https://${s}` }
function isMaybeUrl(v: string) { const s = safeTrim(v); if (!s) return true; if (s.startsWith('//')) return false; if (s.startsWith('/')) return true; try { const u = new URL(normalizeUrl(s)); return u.protocol === 'https:' || u.protocol === 'http:' } catch { return false } }
function fmtInt(n: number) { return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(n) }
function hexValue(v: any): string { if (v == null) return '0x0'; if (typeof v === 'bigint') return ethers.toBeHex(v); if (typeof v === 'number') return ethers.toBeHex(BigInt(v)); if (typeof v === 'string') return v; return '0x0' }

function normalizeTx(tx: any) {
  const out: any = { ...tx }
  out.value = hexValue(out?.value ?? 0)
  const defaultGasPrice = BigInt(ALK_GAS_PRICE_GWEI > 0 ? ALK_GAS_PRICE_GWEI : 5) * 1_000_000_000n
  if (out.gasLimit == null && out.gas == null) out.gasLimit = 250_000
  if (typeof out.gasLimit === 'bigint') out.gasLimit = Number(out.gasLimit)
  if (out.gas == null) out.gas = out.gasLimit
  if (typeof out.gas === 'bigint') out.gas = Number(out.gas)
  out.gasPrice = hexValue(out.gasPrice ?? defaultGasPrice)
  out.type = 0
  return out
}

const FACTORY_IFACE = new Interface([
  'function createToken(string name,string symbol,uint256 initialSupply,address owner) returns (address)',
  'event TokenCreated(address indexed token,address indexed creator,address indexed owner,string name,string symbol,uint8 decimals,uint256 initialSupply)',
])

// token gradient colors — first char fallback
const SYM_COLORS: Record<string, [string, string]> = {
  ALKE:  ['#8B5CF6', '#a78bfa'],
  MAH:   ['#F7B53B', '#e09c25'],
  JLF:   ['#FF5A3C', '#ff7a4d'],
  USDC:  ['#2775CA', '#4a93e8'],
  USDT:  ['#26A17B', '#3fc497'],
  WAKE:  ['#8B5CF6', '#c4b5fd'],
}
function symGrad(s: string) {
  const pair = SYM_COLORS[s.toUpperCase()] ?? ['#FF5A3C', '#F7B53B']
  return `linear-gradient(135deg,${pair[0]},${pair[1]})`
}

// 7-day "new" badge
function isNew(ms?: number) { return !!ms && Date.now() - ms < 7 * 24 * 60 * 60 * 1000 }

export default function Tokens() {
  const { isConnected: walletConnected, address } = useWalletConnection()
  const { sessionSendTransactions } = useSignerSession()
  const alkProvider = useMemo(() => new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID), [])

  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedAddr, setExpandedAddr] = useState<string | null>(null)

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployErr, setDeployErr] = useState<string | null>(null)
  const [deployInfo, setDeployInfo] = useState<string | null>(null)
  const [tName, setTName] = useState('')
  const [tSymbol, setTSymbol] = useState('')
  const [tSupply, setTSupply] = useState('1000000')
  const [tOwner, setTOwner] = useState('')
  const [createdTokenAddr, setCreatedTokenAddr] = useState<string | null>(null)

  // Register modal
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

  const factoryReady = useMemo(() => Boolean(TOKEN_FACTORY_ALK && ethers.isAddress(TOKEN_FACTORY_ALK)), [])

  // ── Admin gating ─────────────────────────────────────────────────────────
  // Seeing admin-only controls requires an allowlisted wallet AIN; actually
  // saving as admin requires signing in with the separate Firebase admin
  // account below. A token's owner (connected wallet's AIN matches the
  // token's ownerAin) can also edit their own token, authenticated via the
  // shared guest Firebase account already used elsewhere in the app.
  const { ain } = useWalletMetaStore()
  const isAdminWallet = useMemo(() => isAdminAin(ain), [ain])
  const [fbUser, setFbUser] = useState<User | null>(null)
  useEffect(() => onAuthStateChanged(auth, setFbUser), [])
  // fbUser alone isn't proof of an admin login — the shared guest account
  // (signed into automatically by wallet-connect/swap/etc.) satisfies it too.
  // Require the signed-in email to be something other than that guest account.
  const isRealAdminLogin = !!fbUser && !!fbUser.email && fbUser.email.trim().toLowerCase() !== GUEST_EMAIL
  const isAdminSession = isAdminWallet && isRealAdminLogin
  function isOwnerOf(t: TokenRow) {
    return !!ain && !!t.ownerAin && ain.trim().toUpperCase() === t.ownerAin.trim().toUpperCase()
  }
  function canEditToken(t: TokenRow) { return isAdminSession || isOwnerOf(t) }

  const [adminLoginOpen, setAdminLoginOpen] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminLoginBusy, setAdminLoginBusy] = useState(false)
  const [adminLoginErr, setAdminLoginErr] = useState<string | null>(null)

  async function onAdminLogin() {
    setAdminLoginErr(null)
    if (!safeTrim(adminEmail) || !adminPassword) { setAdminLoginErr('Enter email and password.'); return }
    try {
      setAdminLoginBusy(true)
      await signInAdmin(safeTrim(adminEmail), adminPassword)
      setAdminLoginOpen(false); setAdminPassword('')
    } catch (e: any) {
      setAdminLoginErr(e?.message || 'Sign-in failed.')
    } finally { setAdminLoginBusy(false) }
  }

  async function onAdminSignOut() { await signOut(auth) }

  // ── Edit token modal ─────────────────────────────────────────────────────
  const [editRow, setEditRow] = useState<TokenRow | null>(null)
  const [eName, setEName] = useState('')
  const [eDesc, setEDesc] = useState('')
  const [eWebsite, setEWebsite] = useState('')
  const [eStatus, setEStatus] = useState('')
  const [eLogoUrl, setELogoUrl] = useState('')
  const [eOwnerAin, setEOwnerAin] = useState('')
  const [eBusy, setEBusy] = useState(false)
  const [eErr, setEErr] = useState<string | null>(null)

  // Only admin can set an owner AIN, and only while it's still empty —
  // once claimed, nobody (including admin) can reassign it from here.
  const ownerAinEditable = !!editRow && isAdminSession && !editRow.ownerAin
  // Status (verification) stays admin-only; owners editing their own token
  // can't self-verify.
  const statusEditable = isAdminSession

  function openEdit(t: TokenRow) {
    setEditRow(t)
    setEName(t.name || '')
    setEDesc(t.description || '')
    setEWebsite(t.website || '')
    setEStatus(t.status || 'Registered')
    setELogoUrl(t.logoUrl || '')
    setEOwnerAin(t.ownerAin || '')
    setEErr(null)
  }
  function closeEdit() { setEditRow(null) }

  async function onSaveEdit() {
    if (!editRow?.id) { setEErr('Missing token id.'); return }
    if (!canEditToken(editRow)) { setEErr('You do not have permission to edit this token.'); return }
    const name = safeTrim(eName)
    if (name.length < 2) { setEErr('Name too short.'); return }
    if (!isMaybeUrl(eWebsite)) { setEErr('Website URL invalid.'); return }
    if (!isMaybeUrl(eLogoUrl)) { setEErr('Logo URL invalid.'); return }
    try {
      setEBusy(true); setEErr(null)
      if (!auth.currentUser) await ensureFirebaseGuest()
      const patch: Record<string, any> = {
        name,
        description: safeTrim(eDesc),
        website: normalizeUrl(eWebsite),
        logoUrl: normalizeUrl(eLogoUrl),
        updatedAtMs: Date.now(),
      }
      if (statusEditable) patch.status = safeTrim(eStatus) || 'Registered'
      if (ownerAinEditable && safeTrim(eOwnerAin)) patch.ownerAin = safeTrim(eOwnerAin).toUpperCase()
      await updateDoc(doc(db, 'tokens', editRow.id), patch)
      closeEdit()
    } catch (e: any) {
      setEErr(e?.message || 'Save failed.')
    } finally {
      setEBusy(false)
    }
  }

  useEffect(() => {
    setLoading(true); setLoadErr(null)
    const q = query(collection(db, 'tokens'), orderBy('createdAtMs', 'desc'), limit(300))
    const unsub = onSnapshot(q, (snap) => {
      const rows: TokenRow[] = []
      snap.forEach((d) => rows.push({ ...(d.data() as TokenRow), id: d.id }))
      setTokens(rows.filter((r) => r.chainId === ALK_CHAIN_ID))
      setLoading(false)
    }, (e) => { setLoadErr(e?.message || 'Failed to load tokens'); setLoading(false) })
    return () => unsub()
  }, [])

  useEffect(() => { if (!createOpen) return; if (address) setTOwner(address) }, [createOpen, address])

  useEffect(() => () => { if (regPollRef.current) window.clearInterval(regPollRef.current) }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return tokens
    return tokens.filter((t) => `${t.symbol} ${t.name} ${t.address} ${t.description ?? ''}`.toLowerCase().includes(s))
  }, [tokens, search])

  // ── Create ────────────────────────────────────────────────────────────────
  function resetCreate() { setTName(''); setTSymbol(''); setTSupply('1000000'); setTOwner(address ?? ''); setDeployErr(null); setDeployInfo(null); setCreatedTokenAddr(null) }

  async function onDeploy() {
    setDeployErr(null); setDeployInfo(null); setCreatedTokenAddr(null)
    if (!walletConnected || !address) { setDeployErr('Connect your wallet first.'); return }
    if (!factoryReady) { setDeployErr('Token Factory not configured.'); return }
    const n = safeTrim(tName); const s = upperSym(safeTrim(tSymbol)); const o = safeTrim(tOwner); const sup = clampAmountStr(safeTrim(tSupply))
    if (n.length < 2) { setDeployErr('Name too short.'); return }
    if (s.length < 2) { setDeployErr('Symbol must be ≥ 2 chars.'); return }
    if (!ethers.isAddress(o)) { setDeployErr('Invalid owner address.'); return }
    if (!sup || Number(sup) <= 0) { setDeployErr('Supply must be > 0.'); return }
    try {
      setDeploying(true)
      const data = FACTORY_IFACE.encodeFunctionData('createToken', [n, s, ethers.parseUnits(sup, 18), o])
      setDeployInfo('Confirm in your wallet…')
      const results = await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: [normalizeTx({ to: TOKEN_FACTORY_ALK, data, value: 0n, gasLimit: 2_200_000 })], failFast: true, preflight: { flow: 'token_create_v1', gasTopup: { enabled: true, purpose: 'jswap-token-create' } } } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'token_create')
      const firstFail = results?.find((r: any) => r?.ok === false); if (firstFail) throw new Error(firstFail.error || 'Transaction failed')
      const txHash = results?.[0]?.txHash; if (!txHash) throw new Error('No txHash from wallet')
      setDeployInfo('Waiting for confirmation…')
      const receipt = await alkProvider.waitForTransaction(txHash, 1); if (!receipt) throw new Error('No receipt yet — try again.')
      let tokenAddr: string | null = null
      for (const log of receipt.logs) { try { const p = FACTORY_IFACE.parseLog(log as any); if (p?.name === 'TokenCreated') { tokenAddr = p.args?.token; break } } catch { } }
      if (!tokenAddr || !ethers.isAddress(tokenAddr)) { setDeployInfo('Deploy confirmed ✅\nCheck explorer for the TokenCreated event to find the address.'); return }
      const addr = ethers.getAddress(tokenAddr); setCreatedTokenAddr(addr)
      setDeployInfo(`Token created ✅\n${addr}`)
    } catch (e: any) { setDeployErr(e?.shortMessage || e?.message || 'Deploy failed.'); setDeployInfo(null) }
    finally { setDeploying(false) }
  }

  // ── Register ──────────────────────────────────────────────────────────────
  function openReg() {
    setRegErr(null); setRegInfo(null); setRegPayTx(null)
    if (createdTokenAddr) setRAddress(createdTokenAddr)
    if (safeTrim(tName)) setRName(safeTrim(tName))
    if (safeTrim(tSymbol)) setRSymbol(upperSym(safeTrim(tSymbol)))
    setRegOpen(true)
  }

  async function callRegApi(payTx: string) {
    // ownerAin is best-effort — the backend may not yet persist this field.
    const body = { paymentTxHash: payTx, tokenAddress: ethers.getAddress(safeTrim(rAddress)), ownerWallet: ethers.getAddress(address!), token: { name: safeTrim(rName), symbol: upperSym(safeTrim(rSymbol)), decimals: 18, description: safeTrim(rDesc), logoUrl: normalizeUrl(rLogoUrl), website: normalizeUrl(rWebsite), ownerAin: ain ? ain.trim().toUpperCase() : null } }
    const res = await fetch(`${FAUCET_API.replace(/\/$/, '')}/tokens/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { res, data: await res.json().catch(() => null) }
  }

  function closeReg() { if (regPollRef.current) window.clearInterval(regPollRef.current); regPollRef.current = null; setRegBusy(false); setRegOpen(false) }

  function startPoll(payTx: string) {
    if (regPollRef.current) window.clearInterval(regPollRef.current)
    const tick = async () => {
      try {
        const { res, data } = await callRegApi(payTx)
        if (res.status === 202 && data?.pending) { setRegInfo(`Confirming ${data?.confirmations ?? 0}/${data?.required ?? REGISTRY_MIN_CONFS}…`); return }
        if (!res.ok || !data?.ok) { setRegErr(data?.error || 'Registration failed.'); setRegInfo(null); if (regPollRef.current) window.clearInterval(regPollRef.current); regPollRef.current = null; setRegBusy(false); return }
        setRegInfo('Registered ✅ Token will appear shortly.'); setRegErr(null)
        if (regPollRef.current) window.clearInterval(regPollRef.current); regPollRef.current = null
        setRegBusy(false); setTimeout(closeReg, 700)
      } catch { }
    }
    tick(); regPollRef.current = window.setInterval(tick, 4000)
  }

  async function onRegPaid() {
    if (regBusy) return; setRegErr(null); setRegInfo(null); setRegPayTx(null)
    if (!walletConnected || !address) { setRegErr('Connect wallet first.'); return }
    const a = safeTrim(rAddress); if (!ethers.isAddress(a)) { setRegErr('Invalid token address.'); return }
    if (safeTrim(rName).length < 2) { setRegErr('Name too short.'); return }
    if (upperSym(safeTrim(rSymbol)).length < 2) { setRegErr('Symbol too short.'); return }
    if (!isMaybeUrl(rLogoUrl)) { setRegErr('Logo URL invalid.'); return }
    if (!isMaybeUrl(rWebsite)) { setRegErr('Website URL invalid.'); return }
    if (!REGISTRY_TREASURY_ALK || !ethers.isAddress(REGISTRY_TREASURY_ALK)) { setRegErr('Registry treasury not configured.'); return }
    try {
      setRegBusy(true); setRegInfo(`Fee: ${fmtInt(REGISTRY_FEE_AKE)} AKE — confirm in wallet…`)
      const payRes = await sessionSendTransactions({ chainId: ALK_CHAIN_ID, txs: [normalizeTx({ to: REGISTRY_TREASURY_ALK, value: ethers.parseEther(String(REGISTRY_FEE_AKE)), gasLimit: 80_000 })], failFast: true, preflight: { flow: 'token_register_pay_v1', gasTopup: { enabled: true, purpose: 'jswap-token-register' } } } as any, { app: APP_NAME, amvaultUrl: AMVAULT_URL }, 'registry_listing')
      const firstFail = payRes?.find((r: any) => r?.ok === false); if (firstFail) throw new Error(firstFail.error || 'Payment failed')
      const payTx = payRes?.[0]?.txHash; if (!payTx) throw new Error('No payment txHash')
      setRegPayTx(payTx); setRegInfo('Payment sent ✅ Verifying…')
      await alkProvider.waitForTransaction(payTx, 1).catch(() => null)
      startPoll(payTx)
    } catch (e: any) { setRegErr(e?.shortMessage || e?.message || 'Registration failed.'); setRegInfo(null); setRegBusy(false) }
  }

  /* ── UI ──────────────────────────────────────────────────────────────────── */

  return (
    <>
      {/* ─────────── HERO STRIP ─────────── */}
      <div style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--soft)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 28px', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg,var(--red),var(--gold))', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                  <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.6"/>
                  <path d="M8.5 14.5c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
                  <circle cx="12" cy="8.5" r="1.25" fill="#fff"/>
                </svg>
              </div>
              <h1 style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 800, fontSize: 30, letterSpacing: '-.025em', color: 'var(--white)', lineHeight: 1 }}>
                Token Directory
              </h1>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginLeft: 54 }}>
              {loading ? 'Loading…' : `${tokens.length} token${tokens.length !== 1 ? 's' : ''} registered`}
              &ensp;·&ensp;
              <span style={{ fontFamily: '"DM Mono"' }}>Chain {ALK_CHAIN_ID}</span>
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {isAdminWallet && (
              isRealAdminLogin ? (
                <button
                  onClick={onAdminSignOut}
                  title={fbUser?.email ?? undefined}
                  style={{ height: 42, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(54,211,153,.3)', background: 'rgba(54,211,153,.08)', color: 'var(--green)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: '"Bricolage Grotesque"' }}
                >
                  Admin ✓ Sign out
                </button>
              ) : (
                <button
                  onClick={() => { setAdminLoginErr(null); setAdminLoginOpen(true) }}
                  style={{ height: 42, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(247,181,59,.3)', background: 'rgba(247,181,59,.08)', color: 'var(--gold)', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: '"Bricolage Grotesque"' }}
                >
                  Admin sign-in
                </button>
              )
            )}
            <button
              onClick={openReg}
              style={{ height: 42, padding: '0 18px', borderRadius: 12, border: '1px solid var(--line)', background: 'rgba(255,255,255,.04)', color: 'var(--white)', fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: '"Bricolage Grotesque"', transition: '.14s' }}
            >
              Register Token
            </button>
            <button
              onClick={() => { resetCreate(); setCreateOpen(true) }}
              disabled={!ENABLE_TOKEN_CREATE}
              style={{ height: 42, padding: '0 20px', borderRadius: 12, border: 'none', background: ENABLE_TOKEN_CREATE ? 'var(--red)' : 'rgba(255,90,60,.25)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: ENABLE_TOKEN_CREATE ? 'pointer' : 'not-allowed', fontFamily: '"Bricolage Grotesque"', opacity: ENABLE_TOKEN_CREATE ? 1 : 0.6, boxShadow: ENABLE_TOKEN_CREATE ? '0 6px 20px rgba(255,90,60,.3)' : 'none', transition: '.14s' }}
              title={!ENABLE_TOKEN_CREATE ? 'Token creation limited in this build' : undefined}
            >
              + Create Token
            </button>
          </div>
        </div>
      </div>

      {/* ─────────── SEARCH BAR ─────────── */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 24px 0' }}>
        <div style={{ position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)', pointerEvents: 'none' }} viewBox="0 0 24 24" fill="none" width="18" height="18">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/>
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by symbol, name or address…"
            style={{ width: '100%', height: 48, paddingLeft: 46, paddingRight: 16, background: 'var(--soft)', border: '1px solid var(--line)', borderRadius: 14, color: 'var(--white)', fontSize: 14.5, outline: 'none', fontFamily: '"DM Sans"', transition: '.15s' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,90,60,.4)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.07)', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, display: 'grid', placeItems: 'center' }}
            >✕</button>
          )}
        </div>

        {/* Recently deployed token alert */}
        {createdTokenAddr && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: 'rgba(54,211,153,.07)', border: '1px solid rgba(54,211,153,.2)', borderRadius: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 18 }}>✅</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>Token deployed</div>
                <div style={{ fontFamily: '"DM Mono"', fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all' }}>{createdTokenAddr}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={() => navigator.clipboard.writeText(createdTokenAddr)} style={ghostBtn}>Copy</button>
              <button onClick={openReg} style={{ ...ghostBtn, background: 'var(--red)', border: 'none', color: '#fff', fontWeight: 700 }}>Register →</button>
            </div>
          </div>
        )}
      </div>

      {/* ─────────── TABLE ─────────── */}
      <div style={{ maxWidth: 1080, margin: '16px auto 80px', padding: '0 24px' }}>
        {loadErr && (
          <div style={{ padding: '12px 16px', background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.22)', borderRadius: 14, fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{loadErr}</div>
        )}

        <div style={{ background: 'var(--soft)', border: '1px solid var(--line-2)', borderRadius: 20, overflow: 'hidden' }}>
          {/* Table header */}
          <div className="jlf-tok-row" style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 70px 110px 120px', gap: 0, padding: '11px 20px', borderBottom: '1px solid var(--line-2)', background: 'var(--surface)' }}>
            {['#', 'Token', 'Address', 'Dec', 'Status', ''].map((h, i) => (
              <div key={i} className={[2,3,4].includes(i) ? 'jlf-tok-hide-sm' : ''} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: i === 5 ? 'right' : 'left', display: 'flex', alignItems: 'center' }}>{h}</div>
            ))}
          </div>

          {/* Skeleton rows */}
          {loading && (
            <div>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="jlf-tok-row" style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 70px 110px 120px', gap: 0, padding: '14px 20px', borderBottom: i < 4 ? '1px solid var(--line-2)' : 'none', alignItems: 'center' }}>
                  <div style={{ width: 22, height: 12, borderRadius: 6, background: 'var(--surface-2)', opacity: .6 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-2)', flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ width: 60, height: 11, borderRadius: 5, background: 'var(--surface-2)' }} />
                      <div style={{ width: 90, height: 10, borderRadius: 5, background: 'var(--surface-2)', opacity: .5 }} />
                    </div>
                  </div>
                  {[0, 1, 2, 3].map((j) => <div key={j} style={{ width: 70, height: 11, borderRadius: 5, background: 'var(--surface-2)', opacity: .4 }} />)}
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '56px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--white)', marginBottom: 6 }}>No tokens found</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{search ? 'Try a different search term.' : 'No tokens registered yet.'}</div>
            </div>
          )}

          {/* Token rows */}
          {!loading && filtered.map((t, idx) => (
            <TokenTableRow
              key={`${t.chainId}:${t.address}`}
              t={t}
              index={idx + 1}
              explorerBase={ALK_EXPLORER}
              symGrad={symGrad}
              isLast={idx === filtered.length - 1}
              expanded={expandedAddr === t.address}
              onToggle={() => setExpandedAddr(expandedAddr === t.address ? null : t.address)}
              isNew={isNew(t.createdAtMs)}
              canEdit={canEditToken(t)}
              onEdit={() => openEdit(t)}
            />
          ))}
        </div>

        {!loading && filtered.length > 0 && (
          <div style={{ marginTop: 14, textAlign: 'center', fontFamily: '"DM Mono"', fontSize: 12, color: 'var(--muted-2)' }}>
            {filtered.length} of {tokens.length} token{tokens.length !== 1 ? 's' : ''}
            {search ? ` matching "${search}"` : ''} · Alkebuleum Chain {ALK_CHAIN_ID}
          </div>
        )}
      </div>

      {/* ─────────── CREATE MODAL ─────────── */}
      {createOpen && (
        <TokModal onClose={() => setCreateOpen(false)} title="Create Token" subtitle="Deploy ERC-20 · 18 decimals · V1 factory">
          <DField label="Token Name">
            <DInput value={tName} onChange={(e) => setTName(e.target.value)} placeholder="e.g. My Community Token" />
          </DField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <DField label="Symbol">
              <DInput value={tSymbol} onChange={(e) => setTSymbol(upperSym(e.target.value))} placeholder="MCT" />
            </DField>
            <DField label="Decimals">
              <DInput value="18" readOnly style={{ opacity: .5, cursor: 'not-allowed' }} />
            </DField>
          </div>
          <DField label="Initial Supply">
            <DInput value={tSupply} onChange={(e) => setTSupply(clampAmountStr(e.target.value))} placeholder="1000000" inputMode="decimal" />
            <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted-2)' }}>Whole tokens — minted to owner with 18 decimals on-chain.</div>
          </DField>
          <DField label="Owner Address">
            <DInput value={tOwner} onChange={(e) => setTOwner(e.target.value)} placeholder={address ?? '0x...'} style={{ fontFamily: '"DM Mono"', fontSize: 12 }} />
          </DField>
          {deployErr && <MsgBox color="red">{deployErr}</MsgBox>}
          {deployInfo && <MsgBox color="gold">{deployInfo}</MsgBox>}
          <button onClick={onDeploy} disabled={!walletConnected || deploying || !factoryReady} className="jlf-action" style={{ marginTop: 6, opacity: (!walletConnected || deploying || !factoryReady) ? .45 : 1, cursor: (!walletConnected || deploying || !factoryReady) ? 'not-allowed' : 'pointer' }}>
            {deploying ? 'Deploying…' : 'Deploy Token'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>After deploy, use <b>Register Token</b> to list it (paid).</div>
        </TokModal>
      )}

      {/* ─────────── REGISTER MODAL ─────────── */}
      {regOpen && (
        <TokModal onClose={closeReg} title="Register Token" subtitle={`List your token · Fee: ${fmtInt(REGISTRY_FEE_AKE)} AKE`}>
          <div style={{ padding: '10px 14px', background: 'rgba(247,181,59,.07)', border: '1px solid rgba(247,181,59,.18)', borderRadius: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold)', marginBottom: 3 }}>Registration fee</div>
            <div style={{ fontFamily: '"DM Mono"', fontSize: 15, color: 'var(--white)' }}>{fmtInt(REGISTRY_FEE_AKE)} AKE <span style={{ color: 'var(--muted)', fontSize: 12 }}>· paid on Alkebuleum</span></div>
          </div>
          <DField label="Token Contract Address">
            <DInput value={rAddress} onChange={(e) => setRAddress(e.target.value)} placeholder="0x..." style={{ fontFamily: '"DM Mono"', fontSize: 12 }} />
            <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted-2)' }}>Save this address — you'll need it for verification.</div>
          </DField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <DField label="Name"><DInput value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Token name" /></DField>
            <DField label="Symbol"><DInput value={rSymbol} onChange={(e) => setRSymbol(upperSym(e.target.value))} placeholder="SYMBOL" /></DField>
          </div>
          <DField label="Description (optional)">
            <textarea value={rDesc} onChange={(e) => setRDesc(e.target.value)} className="jlf-dark-input" style={{ minHeight: 76, resize: 'vertical' }} placeholder="What is this token for?" />
          </DField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <DField label="Logo URL"><DInput value={rLogoUrl} onChange={(e) => setRLogoUrl(e.target.value)} placeholder="https://.../logo.png" /></DField>
            <DField label="Website"><DInput value={rWebsite} onChange={(e) => setRWebsite(e.target.value)} placeholder="https://..." /></DField>
          </div>
          {regErr && <MsgBox color="red">{regErr}</MsgBox>}
          {regInfo && (
            <MsgBox color="green">
              {regInfo}
              {regPayTx && <div style={{ marginTop: 5, fontFamily: '"DM Mono"', fontSize: 11, color: 'var(--muted)' }}>Tx: {shortAddr(regPayTx)}</div>}
            </MsgBox>
          )}
          <button onClick={onRegPaid} disabled={!walletConnected || regBusy} className="jlf-action" style={{ marginTop: 6, opacity: (!walletConnected || regBusy) ? .45 : 1, cursor: (!walletConnected || regBusy) ? 'not-allowed' : 'pointer' }}>
            {regBusy ? 'Processing…' : `Pay ${fmtInt(REGISTRY_FEE_AKE)} AKE & Register`}
          </button>
          <div style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center' }}>
            We verify payment on-chain (min {REGISTRY_MIN_CONFS} confirmations), then list your token.
          </div>
        </TokModal>
      )}

      {/* ─────────── ADMIN SIGN-IN MODAL ─────────── */}
      {adminLoginOpen && (
        <TokModal onClose={() => setAdminLoginOpen(false)} title="Admin sign-in" subtitle="Required to save changes to the token directory">
          <DField label="Email">
            <DInput type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@example.com" autoComplete="username" />
          </DField>
          <DField label="Password">
            <DInput type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </DField>
          {adminLoginErr && <MsgBox color="red">{adminLoginErr}</MsgBox>}
          <button onClick={onAdminLogin} disabled={adminLoginBusy} className="jlf-action" style={{ marginTop: 6, opacity: adminLoginBusy ? .45 : 1, cursor: adminLoginBusy ? 'not-allowed' : 'pointer' }}>
            {adminLoginBusy ? 'Signing in…' : 'Sign in'}
          </button>
        </TokModal>
      )}

      {/* ─────────── EDIT TOKEN MODAL (admin or matching owner AIN) ─────────── */}
      {editRow && (
        <TokModal onClose={closeEdit} title={`Edit ${editRow.symbol}`} subtitle={isAdminSession ? 'Admin — changes are visible to all users immediately' : 'Owner — changes are visible to all users immediately'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: eLogoUrl ? '#fff' : symGrad(editRow.symbol), display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.07)' }}>
              {eLogoUrl
                ? <img src={eLogoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 800, fontSize: 18, color: '#fff' }}>{editRow.symbol.slice(0, 2)}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <DField label="Logo URL">
                <DInput value={eLogoUrl} onChange={(e) => setELogoUrl(e.target.value)} placeholder="https://.../logo.png" />
              </DField>
            </div>
          </div>
          <DField label="Name">
            <DInput value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Token name" />
          </DField>
          <DField label="Description">
            <textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} className="jlf-dark-input" style={{ minHeight: 76, resize: 'vertical' }} placeholder="What is this token for?" />
          </DField>
          <DField label="Website">
            <DInput value={eWebsite} onChange={(e) => setEWebsite(e.target.value)} placeholder="https://..." />
          </DField>
          <DField label="Status">
            {statusEditable ? (
              <select value={eStatus} onChange={(e) => setEStatus(e.target.value)} className="jlf-dark-input">
                <option value="Registered">Registered</option>
                <option value="verified">Verified</option>
                <option value="flagged">Flagged</option>
              </select>
            ) : (
              <DInput value={eStatus} readOnly style={{ opacity: .5, cursor: 'not-allowed' }} />
            )}
          </DField>
          <DField label="Owner AIN">
            {ownerAinEditable ? (
              <>
                <DInput value={eOwnerAin} onChange={(e) => setEOwnerAin(e.target.value.toUpperCase())} placeholder="e.g. AA00000113" style={{ fontFamily: '"DM Mono"', fontSize: 12 }} />
                <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted-2)' }}>Unclaimed — set once to hand this token to its owner's wallet.</div>
              </>
            ) : (
              <>
                <DInput value={eOwnerAin || '—'} readOnly style={{ opacity: .5, cursor: 'not-allowed', fontFamily: '"DM Mono"', fontSize: 12 }} />
                {editRow.ownerAin && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted-2)' }}>Already claimed — can't be reassigned here.</div>}
              </>
            )}
          </DField>
          {eErr && <MsgBox color="red">{eErr}</MsgBox>}
          <button onClick={onSaveEdit} disabled={eBusy} className="jlf-action" style={{ marginTop: 6, opacity: eBusy ? .45 : 1, cursor: eBusy ? 'not-allowed' : 'pointer' }}>
            {eBusy ? 'Saving…' : 'Save changes'}
          </button>
        </TokModal>
      )}
    </>
  )
}

/* ── Table row ─────────────────────────────────────────────────────────────── */

function TokenTableRow({ t, index, explorerBase, symGrad, isLast, expanded, onToggle, isNew: isNewToken, canEdit, onEdit }: {
  t: TokenRow; index: number; explorerBase: string; symGrad: (s: string) => string
  isLast: boolean; expanded: boolean; onToggle: () => void; isNew: boolean
  canEdit: boolean; onEdit: () => void
}) {
  const [copied, setCopied] = useState(false)
  const isNative = !!t.isNative || (t.address || '').toLowerCase() === ZERO_ADDR
  const sym = (t.symbol || '').trim().toUpperCase()
  const fromParam = sym === 'MAH' ? 'ALKE' : 'MAH'
  const toParam = sym === 'MAH' ? 'MAH' : (isNative ? 'ALKE' : t.address)
  const swapUrl = `/swap?from=${encodeURIComponent(fromParam)}&to=${encodeURIComponent(toParam)}`

  function copy() { if (!isNative) { navigator.clipboard.writeText(t.address); setCopied(true); setTimeout(() => setCopied(false), 1600) } }

  const rowBorder = isLast && !expanded ? 'none' : '1px solid var(--line-2)'

  return (
    <>
      {/* Main row */}
      <div
        onClick={onToggle}
        className="jlf-tok-row"
        style={{ display: 'grid', gridTemplateColumns: '40px 1fr 160px 70px 110px 120px', gap: 0, padding: '13px 20px', borderBottom: rowBorder, alignItems: 'center', cursor: 'pointer', transition: '.12s', background: expanded ? 'rgba(255,255,255,.025)' : 'transparent' }}
        onMouseEnter={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.018)' }}
        onMouseLeave={(e) => { if (!expanded) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        {/* # */}
        <div style={{ fontFamily: '"DM Mono"', fontSize: 12, color: 'var(--muted-2)' }}>{index}</div>

        {/* Token identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: t.logoUrl ? '#fff' : symGrad(sym), display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.07)' }}>
            {t.logoUrl
              ? <img src={t.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 800, fontSize: 13, color: '#fff' }}>{sym.slice(0, 2)}</span>}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 15, color: 'var(--white)' }}>{t.symbol}</span>
              {isNewToken && <span style={{ padding: '1px 7px', borderRadius: 100, background: 'rgba(54,211,153,.15)', border: '1px solid rgba(54,211,153,.3)', fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>NEW</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
          </div>
        </div>

        {/* Address */}
        <div
          className="jlf-tok-hide-sm"
          style={{ fontFamily: '"DM Mono"', fontSize: 12.5, color: copied ? 'var(--green)' : 'var(--muted)', cursor: isNative ? 'default' : 'copy', transition: '.12s' }}
          onClick={(e) => { e.stopPropagation(); copy() }}
          title={isNative ? 'Native asset' : t.address}
        >
          {isNative ? <span style={{ color: 'var(--muted-2)' }}>native</span> : (copied ? 'copied ✓' : shortAddr(t.address))}
        </div>

        {/* Decimals */}
        <div className="jlf-tok-hide-sm" style={{ fontFamily: '"DM Mono"', fontSize: 13, color: 'var(--muted)' }}>{t.decimals}</div>

        {/* Status */}
        <div className="jlf-tok-hide-sm">
          <span style={{ padding: '3px 10px', borderRadius: 100, border: '1px solid', borderColor: t.status === 'verified' ? 'rgba(54,211,153,.3)' : 'var(--line)', background: t.status === 'verified' ? 'rgba(54,211,153,.08)' : 'rgba(255,255,255,.03)', fontSize: 11.5, fontWeight: 600, color: t.status === 'verified' ? 'var(--green)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
            {t.status || 'Registered'}
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <button onClick={onEdit} title="Edit token" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(247,181,59,.3)', background: 'rgba(247,181,59,.08)', color: 'var(--gold)', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 13 }}>✎</button>
          )}
          <Link to={swapUrl} style={{ height: 30, padding: '0 12px', borderRadius: 8, background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 12.5, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Swap</Link>
          {!isNative && explorerBase && (
            <a href={`${explorerBase.replace(/\/$/, '')}/address/${t.address}`} target="_blank" rel="noreferrer" style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: 'rgba(255,255,255,.03)', color: 'var(--muted)', display: 'grid', placeItems: 'center', textDecoration: 'none', fontSize: 13 }} title="View on explorer">↗</a>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{ padding: '0 20px 18px', borderBottom: isLast ? 'none' : '1px solid var(--line-2)', background: 'rgba(255,255,255,.022)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>
            {/* Full address */}
            {!isNative && (
              <Detail label="Contract">
                <button onClick={copy} style={{ fontFamily: '"DM Mono"', fontSize: 12, color: copied ? 'var(--green)' : 'var(--white)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', wordBreak: 'break-all' }}>
                  {t.address} {copied ? '✓' : '⎘'}
                </button>
              </Detail>
            )}
            {/* Website */}
            {t.website && (
              <Detail label="Website">
                <a href={t.website} target="_blank" rel="noreferrer" style={{ color: 'var(--muted)', fontSize: 13, textDecoration: 'none' }}>
                  {t.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗
                </a>
              </Detail>
            )}
            {/* Description */}
            {t.description && (
              <Detail label="Description" wide>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>{t.description}</p>
              </Detail>
            )}
            {/* Created */}
            {t.createdAtMs && (
              <Detail label="Listed">
                <span style={{ fontFamily: '"DM Mono"', fontSize: 12, color: 'var(--muted)' }}>
                  {new Date(t.createdAtMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </Detail>
            )}
            {/* Owner AIN */}
            {t.ownerAin && (
              <Detail label="Owner">
                <span style={{ fontFamily: '"DM Mono"', fontSize: 12, color: 'var(--muted)' }}>{t.ownerAin}</span>
              </Detail>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Link to={swapUrl} style={{ height: 34, padding: '0 16px', borderRadius: 10, background: 'var(--red)', color: '#fff', fontWeight: 700, fontSize: 13.5, fontFamily: '"Bricolage Grotesque"', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Swap {t.symbol}</Link>
            {!isNative && (
              <button onClick={copy} style={ghostBtn}>
                {copied ? 'Copied ✓' : 'Copy Address'}
              </button>
            )}
            {!isNative && explorerBase && (
              <a href={`${explorerBase.replace(/\/$/, '')}/address/${t.address}`} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } as any}>Explorer ↗</a>
            )}
            {canEdit && (
              <button onClick={onEdit} style={{ ...ghostBtn, borderColor: 'rgba(247,181,59,.3)', background: 'rgba(247,181,59,.08)', color: 'var(--gold)' }}>
                Edit token
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : {}}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}

/* ── Shared button style ───────────────────────────────────────────────────── */
const ghostBtn: React.CSSProperties = {
  height: 34, padding: '0 14px', borderRadius: 10,
  border: '1px solid var(--line)', background: 'rgba(255,255,255,.04)',
  color: 'var(--white)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
}

/* ── Modal shell ───────────────────────────────────────────────────────────── */
function TokModal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,.72)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: '100%', maxWidth: 500, maxHeight: '92vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 24, boxShadow: '0 40px 80px rgba(0,0,0,.95)' }}>
        <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 800, fontSize: 18, color: 'var(--white)' }}>{title}</div>
            {subtitle && <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--muted)' }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--line)', background: 'rgba(255,255,255,.04)', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, display: 'grid', placeItems: 'center', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
      </div>
    </div>
  )
}

/* ── Form helpers ──────────────────────────────────────────────────────────── */
function DField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  )
}

function DInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="jlf-dark-input" />
}

function MsgBox({ color, children }: { color: 'red' | 'gold' | 'green'; children: React.ReactNode }) {
  const map = {
    red:  { bg: 'rgba(255,90,60,.08)',   border: 'rgba(255,90,60,.22)',   text: 'var(--red)' },
    gold: { bg: 'rgba(247,181,59,.07)',  border: 'rgba(247,181,59,.2)',   text: 'var(--gold)' },
    green:{ bg: 'rgba(54,211,153,.07)',  border: 'rgba(54,211,153,.2)',   text: 'var(--green)' },
  }
  const c = map[color]
  return <div style={{ padding: '10px 14px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, fontSize: 13, color: c.text, whiteSpace: 'pre-wrap' }}>{children}</div>
}
