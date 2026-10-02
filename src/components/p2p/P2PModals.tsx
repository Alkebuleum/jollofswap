// src/components/p2p/P2PModals.tsx
//
// Dialogs for P2P trading (Phase 2): amount, order form, consent, trust
// setup, text prompts and confirmations. Options mirror Nuru's P2P wizards
// (rails, currencies, crypto assets, payment windows).

import React, { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { OrderForm } from '../../lib/p2p/useP2PActions'
import type { TrustReadiness } from '../../lib/p2p/p2pTx'

// ── Options (same as Nuru p2p_tab.dart) ─────────────────────────────────────

export const FIAT_RAILS: { rail: number; label: string }[] = [
  { rail: 1, label: 'Mobile Money' },
  { rail: 4, label: 'Bank Transfer' },
  { rail: 2, label: 'MoneyGram' },
  { rail: 3, label: 'Western Union' },
  { rail: 5, label: 'Cash Pickup' },
  { rail: 6, label: 'Cash in Person' },
  { rail: 7, label: 'Other' },
]
export const CRYPTO_RAIL = 0

export const FIAT_CURRENCIES = [
  'NGN', 'GHS', 'KES', 'USD', 'ZAR', 'XOF', 'XAF', 'GBP', 'EUR',
  'EGP', 'UGX', 'TZS', 'RWF', 'ZMW', 'MWK',
]

/** symbol shown, 3-char bytes3 code stored on-chain */
export const CRYPTO_ASSETS: { symbol: string; code: string }[] = [
  { symbol: 'USDC', code: 'UDC' }, { symbol: 'USDT', code: 'UDT' }, { symbol: 'ETH', code: 'ETH' },
  { symbol: 'BTC', code: 'BTC' }, { symbol: 'BNB', code: 'BNB' }, { symbol: 'SOL', code: 'SOL' },
  { symbol: 'MATIC', code: 'MAT' }, { symbol: 'ALKE', code: 'ALK' }, { symbol: 'Other', code: 'OTH' },
]

export const CRYPTO_NETWORKS = ['Polygon', 'Ethereum', 'BNB Chain', 'Alkebuleum', 'Solana', 'Arbitrum', 'Base', 'Other']
const EVM_NETWORKS = new Set(['Polygon', 'Ethereum', 'BNB Chain', 'Alkebuleum', 'Arbitrum', 'Base'])

export const PAYMENT_WINDOWS = [1, 2, 6, 12, 24, 48, 72]
const windowLabel = (h: number) => (h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : h === 24 ? '1 day' : `${h / 24} days`)

// ── Shell ────────────────────────────────────────────────────────────────────

export function Modal({ title, onClose, children, width = 460 }: {
  title: string; onClose: () => void; children: React.ReactNode; width?: number
}) {
  return (
    <div className="jlf-overlay open" onClick={onClose}>
      <div className="jlf-modal" style={{ maxWidth: width, width: '100%', padding: 22, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 18, color: 'var(--white)' }}>{title}</div>
          <button onClick={onClose} style={iconBtn}><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'none',
  color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center',
}

export const fieldLabel: React.CSSProperties = { fontSize: 12.5, color: 'var(--muted)', marginBottom: 6, display: 'block' }
export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 12px', borderRadius: 12, border: '1px solid var(--line)',
  background: 'var(--leg)', color: 'var(--white)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 14 }}><span style={fieldLabel}>{label}</span>{children}</label>
}

function Err({ msg }: { msg: string | null }) {
  return msg ? <div style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--red)' }}>{msg}</div> : null
}

function Chips<T extends string | number>({ options, value, onChange, render }: {
  options: T[]; value: T; onChange: (v: T) => void; render?: (v: T) => string
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <button
          key={String(o)} type="button" onClick={() => onChange(o)}
          style={{
            padding: '6px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
            border: `1px solid ${o === value ? 'rgba(54,211,153,.4)' : 'var(--line)'}`,
            background: o === value ? 'var(--green-d)' : 'transparent',
            color: o === value ? 'var(--white)' : 'var(--muted)',
          }}
        >{render ? render(o) : String(o)}</button>
      ))}
    </div>
  )
}

// ── Amount (Add MAH / Reclaim) ───────────────────────────────────────────────

export function AmountModal({ title, subtitle, max, confirmLabel, busy, onSubmit, onClose }: {
  title: string; subtitle: string; max: number; confirmLabel: string; busy: boolean
  onSubmit: (amount: number) => void; onClose: () => void
}) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const submit = () => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return setErr('Enter an amount.')
    if (n > max + 1e-9) return setErr(`Max ${max.toLocaleString('en-US', { maximumFractionDigits: 2 })} MAH.`)
    onSubmit(n)
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{subtitle}</div>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={v} onChange={(e) => { setV(e.target.value); setErr(null) }} autoFocus />
        <button type="button" onClick={() => setV(String(Math.floor(max * 100) / 100))} style={{ position: 'absolute', right: 8, top: 7, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--white)', fontSize: 12, cursor: 'pointer' }}>Max</button>
      </div>
      <Err msg={err} />
      <button className="jlf-action" disabled={busy} onClick={submit}>{busy ? 'Working…' : confirmLabel}</button>
    </Modal>
  )
}

// ── Create sell offer / buy request ─────────────────────────────────────────

export function OrderFormModal({ side, maxMah, defaultCryptoAddress, busy, onSubmit, onClose }: {
  side: 'sell' | 'buy'
  /** Sell: escrow available. Buy: no cap (null). */
  maxMah: number | null
  defaultCryptoAddress: string
  busy: boolean
  onSubmit: (f: OrderForm) => void
  onClose: () => void
}) {
  const sell = side === 'sell'
  const [mah, setMah] = useState('')
  const [isCrypto, setIsCrypto] = useState(false)
  const [rail, setRail] = useState(1)
  const [currency, setCurrency] = useState('NGN')
  const [asset, setAsset] = useState(CRYPTO_ASSETS[0])
  const [network, setNetwork] = useState('Polygon')
  const [amount, setAmount] = useState('')
  const [details, setDetails] = useState(sell ? '' : '')
  const [reference, setReference] = useState('')
  const [windowH, setWindowH] = useState(24)
  const [err, setErr] = useState<string | null>(null)

  const unit = isCrypto ? asset.symbol : currency
  const rate = useMemo(() => {
    const m = Number(mah), a = Number(amount)
    return m > 0 && a > 0 ? a / m : null
  }, [mah, amount])

  const switchCrypto = (c: boolean) => {
    setIsCrypto(c)
    if (sell && c && EVM_NETWORKS.has(network) && !details) setDetails(defaultCryptoAddress)
  }

  const submit = () => {
    const m = Number(mah), a = Number(amount)
    if (!(m > 0)) return setErr('Enter how much MAH.')
    if (maxMah != null && m > maxMah + 1e-9) return setErr(`Exceeds your available P2P balance (${maxMah.toFixed(2)} MAH). Add MAH first.`)
    if (!(a > 0)) return setErr(`Enter the ${unit} amount.`)
    // Same format as Nuru, so offers read identically in both apps.
    const payInfo = isCrypto ? `Network: ${network}\nAddress: ${details.trim()}` : details.trim()
    if (sell && !details.trim()) return setErr(isCrypto ? 'Enter your wallet address on this network.' : 'Enter payment details so the buyer knows how to pay you.')
    onSubmit({
      mahAmount: m,
      fiatAmount: a,
      currency: isCrypto ? asset.code : currency,
      currencyDisplay: isCrypto ? asset.symbol : currency,
      rail: isCrypto ? CRYPTO_RAIL : rail,
      paymentDetails: sell ? payInfo : '',
      reference: reference.trim(),
      paymentWindowHours: windowH,
    })
  }

  return (
    <Modal title={sell ? 'Sell MAH' : 'Buy MAH'} onClose={onClose} width={500}>
      <Field label={sell ? `MAH to sell${maxMah != null ? ` (available ${maxMah.toFixed(2)})` : ''}` : 'MAH to buy'}>
        <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={mah} onChange={(e) => { setMah(e.target.value); setErr(null) }} />
      </Field>

      <Field label={sell ? 'Get paid with' : 'Pay with'}>
        <Chips options={['Local money', 'Crypto']} value={isCrypto ? 'Crypto' : 'Local money'} onChange={(v) => switchCrypto(v === 'Crypto')} />
      </Field>

      {!isCrypto ? (
        <>
          <Field label="Payment method">
            <Chips options={FIAT_RAILS.map((r) => r.rail)} value={rail} onChange={setRail} render={(r) => FIAT_RAILS.find((x) => x.rail === r)!.label} />
          </Field>
          <Field label="Currency">
            <select style={inputStyle} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {FIAT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Asset">
            <select style={inputStyle} value={asset.symbol} onChange={(e) => setAsset(CRYPTO_ASSETS.find((a) => a.symbol === e.target.value)!)}>
              {CRYPTO_ASSETS.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol}</option>)}
            </select>
          </Field>
          <Field label="Network">
            <select style={inputStyle} value={network} onChange={(e) => setNetwork(e.target.value)}>
              {CRYPTO_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
      )}

      <Field label={`${sell ? 'You receive' : 'You pay'} (${unit})`}>
        <input style={inputStyle} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(null) }} />
        {rate != null && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted-2)', fontFamily: '"DM Mono"' }}>{rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} {unit} per MAH</div>}
      </Field>

      {sell && (
        <Field label={isCrypto ? `Your ${asset.symbol} address on ${network}` : 'Your payment details (shown to the buyer only)'}>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} placeholder={isCrypto ? '0x…' : 'e.g. MTN MoMo 024 000 0000 — Ama Mensah'} value={details} onChange={(e) => { setDetails(e.target.value); setErr(null) }} />
        </Field>
      )}

      <Field label="Payment window">
        <Chips options={PAYMENT_WINDOWS} value={windowH} onChange={setWindowH} render={windowLabel} />
      </Field>

      <Field label="Note (optional)">
        <input style={inputStyle} placeholder={sell ? 'e.g. Available evenings' : 'e.g. Need MAH within 2 hours'} value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>

      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
        {sell
          ? 'Your MAH is locked when a buyer commits, and released to them once you confirm their payment. You can cancel an offer nobody has taken.'
          : 'A seller who accepts locks their MAH for you. Pay them within the window, then mark it paid.'}
      </div>
      <Err msg={err} />
      <button className="jlf-action" disabled={busy} onClick={submit}>{busy ? 'Working…' : sell ? 'Create sell offer' : 'Create buy request'}</button>
    </Modal>
  )
}

// ── Consent (Nuru's terms, one time) ─────────────────────────────────────────

export function ConsentModal({ ain, onAccept, onClose }: { ain: string; onAccept: () => void; onClose: () => void }) {
  const items: [string, string][] = [
    ['Your trade history is permanent', `Every trade you create, accept, or complete is recorded on-chain and linked to your identity (${ain}). This record is public and cannot be deleted.`],
    ['Trades affect your trust score', 'Completing trades on time builds your reputation. Failing to pay, abandoning a trade, or losing a dispute will lower your trust tier and may restrict your access to larger trades in the future.'],
    ['MAH is locked during a trade', "When a sell offer is matched, the seller's MAH is locked until the buyer confirms payment and the seller releases it — or an arbiter resolves a dispute."],
    ['Disputes go to arbitration', 'If you and your counterparty disagree, either side can open a dispute. A Nuru arbiter reviews the evidence and issues a binding on-chain ruling. Frivolous disputes may affect your standing.'],
    ['You are responsible for compliance', 'Ensure your use of P2P trading complies with the laws and regulations in your jurisdiction. JollofSwap and Nuru do not provide financial or legal advice.'],
  ]
  return (
    <Modal title="Before you trade" onClose={onClose} width={500}>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
        P2P lets you trade MAH directly with other people using real payment methods — mobile money, bank transfer, crypto, and more. Trades are enforced by smart contracts on Alkebuleum.
      </div>
      {items.map(([h, b]) => (
        <div key={h} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--white)' }}>{h}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginTop: 2 }}>{b}</div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: 'var(--muted-2)', lineHeight: 1.5, margin: '6px 0 14px' }}>
        By continuing you confirm you have read and accept these terms, and that your on-chain identity ({ain}) will record your trading activity on Alkebuleum.
      </div>
      <button className="jlf-action" onClick={onAccept}>I understand, continue</button>
    </Modal>
  )
}

// ── One-time trust setup ─────────────────────────────────────────────────────

export function SetupModal({ trust, busy, onRun, onClose }: {
  trust: TrustReadiness; busy: boolean; onRun: () => void; onClose: () => void
}) {
  const steps: [string, boolean][] = [
    ['Register your reputation profile', trust.reputationRegistered],
    ['Register your credit profile', trust.creditRegistered],
    ['Authorize the P2P escrow (up to 10,000 MAH, 1 year)', trust.delegateAuthorized],
  ]
  return (
    <Modal title="Set up P2P" onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>
        A one-time setup on your identity. Each missing step is a transaction you approve in your wallet.
      </div>
      {steps.map(([label, done]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--line-2)', fontSize: 13 }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 11, background: done ? 'var(--green-d)' : 'var(--leg-2)', color: done ? 'var(--green)' : 'var(--muted-2)' }}>{done ? '✓' : '•'}</span>
          <span style={{ color: done ? 'var(--muted)' : 'var(--white)' }}>{label}</span>
        </div>
      ))}
      <button className="jlf-action" style={{ marginTop: 16 }} disabled={busy} onClick={onRun}>{busy ? 'Setting up…' : 'Run setup'}</button>
    </Modal>
  )
}

// ── Text prompt (accept payment details / payment receipt) ──────────────────

export function TextPromptModal({ title, intro, label, placeholder, initial = '', required, confirmLabel, busy, onSubmit, onClose }: {
  title: string; intro: React.ReactNode; label: string; placeholder: string; initial?: string
  required: boolean; confirmLabel: string; busy: boolean; onSubmit: (v: string) => void; onClose: () => void
}) {
  const [v, setV] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 14 }}>{intro}</div>
      <Field label={label}>
        <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} placeholder={placeholder} value={v} onChange={(e) => { setV(e.target.value); setErr(null) }} autoFocus />
      </Field>
      <Err msg={err} />
      <button className="jlf-action" disabled={busy} onClick={() => (required && !v.trim() ? setErr('This is required.') : onSubmit(v.trim()))}>{busy ? 'Working…' : confirmLabel}</button>
    </Modal>
  )
}

// ── Confirm ──────────────────────────────────────────────────────────────────

export function ConfirmModal({ title, body, confirmLabel, danger, busy, onConfirm, onClose }: {
  title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; busy: boolean
  onConfirm: () => void; onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 16 }}>{body}</div>
      <button
        className="jlf-action" disabled={busy} onClick={onConfirm}
        style={danger ? { background: 'rgba(255,90,60,.15)', color: 'var(--red)', border: '1px solid rgba(255,90,60,.35)' } : undefined}
      >{busy ? 'Working…' : confirmLabel}</button>
    </Modal>
  )
}
