// src/pages/P2P.tsx
//
// P2P market on the same MAH escrow Nuru's P2P tab uses: escrow balance,
// trust scores, the open market, your orders and order details (Phase 1),
// plus trading (Phase 2): add/reclaim MAH, sell offers, buy requests and
// every order action, and disputes (Phase 3): open one, follow its status
// and the arbiter's ruling. Push alerts + dispute chat stay in Nuru ("Reply
// in Nuru" deep-links into the app). /p2p?order=<id> opens that order.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X, RefreshCw, ShieldCheck, Key, Wallet, Scale, MessageCircle } from 'lucide-react'
import {
  AmountModal,
  ConfirmModal,
  ConsentModal,
  OrderFormModal,
  SetupModal,
  TextPromptModal,
} from '../components/p2p/P2PModals'
import { availableActions, useP2PActions, type OrderAction } from '../lib/p2p/useP2PActions'
import {
  needsSetup,
  nuruDisputeChatLink,
  P2P_CONSENT_KEY,
  watchDispute,
  type DisputeCase,
  type TrustReadiness,
} from '../lib/p2p/p2pTx'
import { canTradeP2P } from '../lib/p2p/config'
import { FLAGS } from '../lib/flags'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { useWcStore } from '../store/wcStore'
import { useConnectModalStore } from '../store/connectModalStore'
import {
  fetchEscrowBalances,
  fetchOpenOrders,
  fetchOrderById,
  fetchTrustScores,
  fetchUserOrders,
  fiatHuman,
  isClosed,
  isSellOffer,
  mahHuman,
  railLabel,
  resolveParticipant,
  statusLabel,
  unitPrice,
  type EscrowBalance,
  type P2POrder,
  type Participant,
  type TrustScores,
} from '../lib/p2p/p2pService'

const REFRESH_MS = 20_000

function short(a?: string | null) {
  if (!a) return '—'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function fmtNum(n: number, max = 2) {
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

function fmtDate(sec: number) {
  if (!sec) return '—'
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_COLOR: Record<number, string> = {
  0: 'var(--green)',
  1: 'var(--gold)',
  2: 'var(--gold)',
  3: 'var(--muted)',
  4: 'var(--red)',
  5: 'var(--muted)',
  6: 'var(--muted-2)',
  7: 'var(--muted-2)',
}

export default function P2P() {
  const { isConnected, address } = useWalletConnection()
  const { ain, aaWallet, primaryHandle } = useWalletMetaStore()
  const signer = useWcStore((s) => s.signer)
  const openConnectModal = useConnectModalStore((s) => s.openModal)

  const [tab, setTab] = useState<'market' | 'mine'>('market')
  const [showClosed, setShowClosed] = useState(false)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [balance, setBalance] = useState<EscrowBalance | null>(null)
  const [trust, setTrust] = useState<TrustScores | null>(null)
  const [market, setMarket] = useState<P2POrder[] | null>(null)
  const [mine, setMine] = useState<P2POrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<P2POrder | null>(null)

  // Every address that can hold this user's orders (Nuru Account + key).
  const myAddresses = useMemo(
    () => [aaWallet, signer, address].filter((a): a is string => !!a),
    [aaWallet, signer, address],
  )

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const marketP = fetchOpenOrders(50, myAddresses)
      if (isConnected) {
        const p = await resolveParticipant({ ain, aaWallet, signer: signer ?? address })
        const [bal, orders, scores, open] = await Promise.all([
          fetchEscrowBalances(p.address),
          fetchUserOrders(myAddresses),
          fetchTrustScores(ain),
          marketP,
        ])
        setParticipant(p); setBalance(bal); setMine(orders); setTrust(scores); setMarket(open)
      } else {
        setParticipant(null); setBalance(null); setMine(null); setTrust(null)
        setMarket(await marketP)
      }
      setError(null)
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Could not load P2P data.')
    } finally {
      setLoading(false)
    }
  }, [isConnected, ain, aaWallet, signer, address, myAddresses])

  useEffect(() => {
    load()
    const id = window.setInterval(() => load(true), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  // /p2p?order=<id> (Nuru notification taps) — open that order once.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepOrder = searchParams.get('order')
  useEffect(() => {
    if (!deepOrder || !/^\d+$/.test(deepOrder)) return
    let alive = true
    fetchOrderById(BigInt(deepOrder)).then((o) => {
      if (!alive) return
      if (o) setSelected(o)
      else setError(`Order #${deepOrder} was not found.`)
      const next = new URLSearchParams(searchParams); next.delete('order')
      setSearchParams(next, { replace: true })
    })
    return () => { alive = false }
  }, [deepOrder]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleMine = useMemo(
    () => (mine ?? []).filter((o) => showClosed || !isClosed(o)),
    [mine, showClosed],
  )
  const activeCount = (mine ?? []).filter((o) => !isClosed(o)).length

  // ── Trading (Phase 2) ──────────────────────────────────────────────────────
  const acct = aaWallet && signer && aaWallet.toLowerCase() !== signer.toLowerCase() ? aaWallet : null
  const actions = useP2PActions(
    { ain, handle: primaryHandle, participant, aaWallet: acct, myAddresses },
    () => { setSelected(null); window.setTimeout(() => load(true), 3000) },
  )
  type Dialog =
    | { kind: 'deposit'; max: number; subtitle: string }
    | { kind: 'withdraw' }
    | { kind: 'order'; side: 'sell' | 'buy' }
    | { kind: 'consent'; then: () => void }
    | { kind: 'setup'; trust: TrustReadiness; then: () => void }
    | { kind: 'accept'; order: P2POrder }
    | { kind: 'markPaid'; order: P2POrder }
    | { kind: 'dispute'; order: P2POrder }
    | { kind: 'confirm'; order: P2POrder; action: 'commit' | 'release' | 'cancel' | 'expire' }
  const [dialog, setDialog] = useState<Dialog | null>(null)
  // Trading rollout gate (FLAGS.P2P_TRADING_OPEN / VITE_P2P_TRADING_AINS).
  const tradingEnabled = isConnected && canTradeP2P(ain, FLAGS.P2P_TRADING_OPEN)
  const closeDialog = () => setDialog(null)
  const available = balance?.available ?? 0

  const consentGiven = () => {
    try { return localStorage.getItem(P2P_CONSENT_KEY) === '1' } catch { return false }
  }

  /** Nuru's _resolveP2PSource: consent → controller → one-time setup → hard blocks. */
  const ensureReady = async (then: () => void) => {
    actions.clearMessages()
    if (!ain) { setError('No identity (AIN) found for this connection.'); return }
    if (!consentGiven()) {
      setDialog({ kind: 'consent', then: () => ensureReady(then) })
      return
    }
    if (!participant || participant.holder === 'unknown') {
      setError("Neither your key nor your Nuru Account is this identity's AIN controller, so it can't trade in the escrow.")
      return
    }
    let t: TrustReadiness
    try { t = await actions.readiness() } catch (e: any) { setError(e?.message || 'Could not check P2P setup.'); return }
    if (needsSetup(t)) { setDialog({ kind: 'setup', trust: t, then: () => ensureReady(then) }); return }
    if (t.reputationSuspended) { setError('Your account has been suspended. Contact support.'); return }
    if (t.creditRestricted) { setError('Your account has credit restrictions. Contact support.'); return }
    if (!t.domainAllowed) { setError('P2P is not available for this identity yet.'); return }
    then()
  }

  const openDeposit = async () => {
    actions.clearMessages()
    try {
      const { holderBal, accountBal, fromAccount } = await actions.depositSources()
      const h = mahHuman(holderBal), a = mahHuman(accountBal)
      setDialog({
        kind: 'deposit',
        max: h + (fromAccount ? a : 0),
        subtitle: fromAccount && a > 0
          ? `Wallet: ${fmtNum(h)} on your key + ${fmtNum(a)} on your Nuru Account`
          : `Available in your wallet: ${fmtNum(h)} MAH`,
      })
    } catch (e: any) { setError(e?.message || 'Could not read your MAH balance.') }
  }

  const startSell = () => ensureReady(() => {
    if (available <= 0) { setError('Add MAH to your P2P balance first — it is locked when a buyer commits.'); openDeposit(); return }
    setDialog({ kind: 'order', side: 'sell' })
  })
  const startBuy = () => ensureReady(() => setDialog({ kind: 'order', side: 'buy' }))

  const onOrderAction = (o: P2POrder, a: OrderAction) => {
    switch (a) {
      case 'commit': return ensureReady(() => setDialog({ kind: 'confirm', order: o, action: 'commit' }))
      case 'accept': return ensureReady(() => {
        if (available < mahHuman(o.mahAmount)) {
          setError(`You need at least ${fmtNum(mahHuman(o.mahAmount))} MAH in your P2P balance to accept this.`)
          openDeposit(); return
        }
        setDialog({ kind: 'accept', order: o })
      })
      case 'markPaid': return setDialog({ kind: 'markPaid', order: o })
      case 'release': case 'cancel': case 'expire': return setDialog({ kind: 'confirm', order: o, action: a })
      case 'dispute': return setDialog({ kind: 'dispute', order: o })
      case 'viewDispute': window.location.href = nuruDisputeChatLink(o.id.toString()); return
    }
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px 64px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h1 style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 26, margin: 0, color: 'var(--white)' }}>P2P</h1>
        {tradingEnabled && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button className="jlf-chip" disabled={actions.busy} onClick={startBuy} style={{ fontWeight: 600 }}>Buy MAH</button>
            <button className="jlf-chip" disabled={actions.busy} onClick={startSell} style={{ fontWeight: 600 }}>Sell MAH</button>
          </div>
        )}
        <button
          onClick={() => load()}
          title="Refresh"
          style={{ marginLeft: tradingEnabled ? 0 : 'auto', background: 'none', border: '1px solid var(--line)', borderRadius: 10, padding: 7, color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
        >
          <RefreshCw size={14} className={loading ? 'jlf-spin-icon' : undefined} />
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>
        {tradingEnabled
          ? 'Trade MAH for local currency or crypto with escrow protection. Alerts and dispute messages arrive in the Nuru app.'
          : 'Trade MAH for local currency or crypto with escrow protection. Trading here is rolling out — for now, place and manage trades in the Nuru app.'}
      </p>

      {(actions.info || actions.error) && (
        <div style={{
          marginBottom: 14, padding: '10px 14px', borderRadius: 14, fontSize: 13, whiteSpace: 'pre-wrap',
          color: actions.error ? 'var(--red)' : 'var(--green)',
          background: actions.error ? 'rgba(255,90,60,.08)' : 'rgba(54,211,153,.06)',
          border: `1px solid ${actions.error ? 'rgba(255,90,60,.22)' : 'rgba(54,211,153,.18)'}`,
        }}>
          {actions.error || actions.info}
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 14, fontSize: 13, color: 'var(--red)', background: 'rgba(255,90,60,.08)', border: '1px solid rgba(255,90,60,.22)' }}>
          {error}
        </div>
      )}

      {/* Account: escrow balance + trust */}
      {isConnected ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 18 }}>
          <div className="jlf-panel" style={{ padding: 20 }}>
            <div style={sectionLabel}>Escrow balance</div>
            <div style={{ fontFamily: '"DM Mono"', fontSize: 24, fontWeight: 600, color: 'var(--white)' }}>
              {balance ? fmtNum(balance.deposited) : '—'} <span style={{ fontSize: 14, color: 'var(--muted)' }}>MAH</span>
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12.5, color: 'var(--muted)' }}>
              <span>Available <b style={{ color: 'var(--white)', fontFamily: '"DM Mono"' }}>{balance ? fmtNum(balance.available) : '—'}</b></span>
              <span>Locked <b style={{ color: 'var(--white)', fontFamily: '"DM Mono"' }}>{balance ? fmtNum(balance.locked) : '—'}</b></span>
            </div>
            {participant && (
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-2)' }}>
                {participant.holder === 'key' ? <Key size={12} /> : <Wallet size={12} />}
                Trading as {participant.holder === 'key' ? 'Key Account' : 'Nuru Account'}
                <span style={{ fontFamily: '"DM Mono"' }}>{short(participant.address)}</span>
              </div>
            )}
            {tradingEnabled && <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="jlf-chip" disabled={actions.busy || !participant || participant.holder === 'unknown'} onClick={openDeposit}>Add MAH</button>
              <button className="jlf-chip" disabled={actions.busy || available <= 0} onClick={() => { actions.clearMessages(); setDialog({ kind: 'withdraw' }) }}>Reclaim</button>
            </div>}
          </div>

          <div className="jlf-panel" style={{ padding: 20 }}>
            <div style={sectionLabel}>
              Trust {primaryHandle || ain ? <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>· {primaryHandle || ain}</span> : null}
            </div>
            <TrustBars scores={trust} />
          </div>
        </div>
      ) : (
        <div className="jlf-panel" style={{ padding: 22, marginBottom: 18, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--white)', fontWeight: 600 }}>Connect to see your escrow and orders</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, marginBottom: 14 }}>You can browse the market without connecting.</div>
          <button className="jlf-action" style={{ maxWidth: 260, margin: '0 auto' }} onClick={openConnectModal}>Connect wallet</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <TabBtn active={tab === 'market'} onClick={() => setTab('market')} label="Market" count={market?.length} />
        {isConnected && <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')} label="My orders" count={activeCount} />}
        {tab === 'mine' && (
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed
          </label>
        )}
      </div>

      <OrderList
        orders={tab === 'market' ? market : visibleMine}
        loading={(tab === 'market' ? market : mine) === null}
        empty={tab === 'market' ? 'No open offers right now.' : showClosed ? 'No orders yet.' : 'No active orders.'}
        myAddresses={myAddresses}
        onOpen={setSelected}
      />

      {selected && (
        <OrderDetail
          order={selected}
          myAddresses={myAddresses}
          canTrade={tradingEnabled}
          connected={isConnected}
          busy={actions.busy}
          onAction={(a) => onOrderAction(selected, a)}
          onClose={() => setSelected(null)}
        />
      )}

      {dialog?.kind === 'deposit' && (
        <AmountModal
          title="Add MAH to P2P" subtitle={dialog.subtitle} max={dialog.max} confirmLabel="Add MAH" busy={actions.busy}
          onClose={closeDialog} onSubmit={async (n) => { if (await actions.deposit(n)) closeDialog() }}
        />
      )}
      {dialog?.kind === 'withdraw' && (
        <AmountModal
          title="Reclaim MAH" subtitle={`Available to reclaim: ${fmtNum(available)} MAH`} max={available} confirmLabel="Reclaim" busy={actions.busy}
          onClose={closeDialog} onSubmit={async (n) => { if (await actions.withdraw(n)) closeDialog() }}
        />
      )}
      {dialog?.kind === 'order' && (
        <OrderFormModal
          side={dialog.side} maxMah={dialog.side === 'sell' ? available : null}
          defaultCryptoAddress={signer ?? address ?? ''} busy={actions.busy} onClose={closeDialog}
          onSubmit={async (f) => {
            const ok = dialog.side === 'sell' ? await actions.createSellOffer(f) : await actions.createBuyRequest(f)
            if (ok) { closeDialog(); setTab('mine') }
          }}
        />
      )}
      {dialog?.kind === 'consent' && (
        <ConsentModal
          ain={ain ?? ''} onClose={closeDialog}
          onAccept={() => {
            try { localStorage.setItem(P2P_CONSENT_KEY, '1') } catch { /* private mode — asks again */ }
            const next = dialog.then; closeDialog(); next()
          }}
        />
      )}
      {dialog?.kind === 'setup' && (
        <SetupModal
          trust={dialog.trust} busy={actions.busy} onClose={closeDialog}
          onRun={async () => { const next = dialog.then; if (await actions.setup(dialog.trust)) { closeDialog(); next() } }}
        />
      )}
      {dialog?.kind === 'accept' && (
        <TextPromptModal
          title="Accept & sell"
          intro={<>You lock <b>{fmtNum(mahHuman(dialog.order.mahAmount))} MAH</b> from your P2P balance for this buyer, who pays you <b>{fmtNum(fiatHuman(dialog.order.fiatAmountMinor))} {dialog.order.fiatCurrency}</b> via {railLabel(dialog.order.rail)}. Release the MAH only after you have the payment.</>}
          label="Your payment details (shown to this buyer only)" placeholder="e.g. MTN MoMo 024 000 0000 — Ama Mensah"
          required confirmLabel="Accept & sell" busy={actions.busy} onClose={closeDialog}
          onSubmit={async (v) => { if (await actions.accept(dialog.order, v)) closeDialog() }}
        />
      )}
      {dialog?.kind === 'markPaid' && (
        <TextPromptModal
          title="I've sent payment"
          intro={<>Only mark this paid after you actually sent <b>{fmtNum(fiatHuman(dialog.order.fiatAmountMinor))} {dialog.order.fiatCurrency}</b>. The seller then checks and releases the MAH to you.</>}
          label="Payment receipt / transaction reference" placeholder="e.g. MoMo ref TXN123456, sent 14:05"
          required={false} confirmLabel="Mark as paid" busy={actions.busy} onClose={closeDialog}
          onSubmit={async (v) => { if (await actions.markPaid(dialog.order, v)) closeDialog() }}
        />
      )}
      {dialog?.kind === 'dispute' && (
        <TextPromptModal
          title="Open dispute"
          intro={<>Order #{dialog.order.id.toString()} · {fmtNum(mahHuman(dialog.order.mahAmount))} MAH. Only open a dispute if the other party has not fulfilled their obligation — an arbiter reviews the evidence and issues a binding on-chain ruling. Unfounded disputes may affect your trust score.</>}
          label="Evidence / reason"
          placeholder="e.g. Payment was sent 6 hours ago (ref: TXN123) but the seller has not released MAH"
          required confirmLabel="Open dispute" busy={actions.busy} onClose={closeDialog}
          onSubmit={async (v) => { if (await actions.openDispute(dialog.order, v)) closeDialog() }}
        />
      )}
      {dialog?.kind === 'confirm' && (() => {
        const o = dialog.order
        const mah = `${fmtNum(mahHuman(o.mahAmount))} MAH`
        const pay = `${fmtNum(fiatHuman(o.fiatAmountMinor))} ${o.fiatCurrency}`
        const cfg = {
          commit: { title: 'Accept & buy', body: <>You commit to buy <b>{mah}</b> for <b>{pay}</b> via {railLabel(o.rail)}. The seller's MAH is locked for you; pay them within the payment window, then mark it paid. Not paying lowers your trust score.</>, label: 'Accept & buy', danger: false, run: () => actions.commit(o) },
          release: { title: 'Release MAH', body: <>Release <b>{mah}</b> to the buyer. Only do this once you have received <b>{pay}</b> — it can't be undone.{o.meta?.receiptNote ? <><br /><br />Buyer's receipt: <i>{o.meta.receiptNote}</i></> : null}</>, label: 'Release MAH', danger: false, run: () => actions.release(o) },
          cancel: { title: 'Cancel order', body: <>Cancel order #{o.id.toString()}? Nobody has taken it yet, so nothing is lost.</>, label: 'Cancel order', danger: true, run: () => actions.cancel(o) },
          expire: { title: 'Close overdue order', body: <>The buyer didn't pay before the deadline. Closing returns your locked <b>{mah}</b> to your P2P balance.</>, label: 'Close order', danger: true, run: () => actions.expire(o) },
        }[dialog.action]
        return (
          <ConfirmModal
            title={cfg.title} body={cfg.body} confirmLabel={cfg.label} danger={cfg.danger} busy={actions.busy}
            onClose={closeDialog} onConfirm={async () => { if (await cfg.run()) closeDialog() }}
          />
        )
      })()}
    </div>
  )
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 10,
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        border: `1px solid ${active ? 'var(--line)' : 'transparent'}`,
        background: active ? 'var(--surface)' : 'transparent',
        color: active ? 'var(--white)' : 'var(--muted)',
      }}
    >
      {label}{count != null && count > 0 ? <span style={{ marginLeft: 6, color: 'var(--muted)' }}>{count}</span> : null}
    </button>
  )
}

function TrustBars({ scores }: { scores: TrustScores | null }) {
  if (!scores) {
    return <div style={{ fontSize: 13, color: 'var(--muted)' }}>No trust profile found.</div>
  }
  const bar = (label: string, registered: boolean, score: number, tier: number, flag?: string | null) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
        <span style={{ color: 'var(--muted)' }}>{label}</span>
        <span style={{ fontFamily: '"DM Mono"', color: registered ? 'var(--white)' : 'var(--muted-2)' }}>
          {registered ? `${score} / 1000 · tier ${tier}` : 'Not registered'}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--leg-2)', overflow: 'hidden' }}>
        <div style={{ width: `${registered ? Math.min(100, score / 10) : 0}%`, height: '100%', background: flag ? 'var(--red)' : 'var(--green)' }} />
      </div>
      {flag && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{flag}</div>}
    </div>
  )
  return (
    <>
      {bar('Reputation', scores.reputationRegistered, scores.reputationScore, scores.reputationTier, scores.suspended ? 'Suspended' : null)}
      {bar('Credit', scores.creditRegistered, scores.creditScore, scores.creditTier, scores.creditRestricted ? 'Restricted' : null)}
    </>
  )
}

function OrderList({ orders, loading, empty, myAddresses, onOpen }: {
  orders: P2POrder[] | null
  loading: boolean
  empty: string
  myAddresses: string[]
  onOpen: (o: P2POrder) => void
}) {
  if (loading) {
    return <div className="jlf-panel" style={{ padding: 28, textAlign: 'center' }}><div className="jlf-spin" style={{ margin: '0 auto' }} /></div>
  }
  if (!orders || orders.length === 0) {
    return <div className="jlf-panel" style={{ padding: 28, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>{empty}</div>
  }
  const mine = new Set(myAddresses.map((a) => a.toLowerCase()))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {orders.map((o) => {
        const sell = isSellOffer(o)
        const price = unitPrice(o)
        const iAmMaker = mine.has(o.maker.toLowerCase())
        const who = o.meta?.creatorHandle || o.makerAin || short(o.maker)
        return (
          <button
            key={o.id.toString()}
            onClick={() => onOpen(o)}
            className="jlf-panel"
            style={{ padding: '14px 16px', textAlign: 'left', cursor: 'pointer', width: '100%', display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, color: 'var(--white)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: sell ? 'var(--green)' : 'var(--gold)', background: sell ? 'var(--green-d)' : 'rgba(247,181,59,.1)' }}>
                {sell ? 'SELLING MAH' : 'BUYING MAH'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>#{o.id.toString()} · {iAmMaker ? 'You' : who}</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOR[o.status] ?? 'var(--muted)' }}>{statusLabel(o.status)}</span>
            <div style={{ fontFamily: '"DM Mono"', fontSize: 16, fontWeight: 600 }}>
              {fmtNum(mahHuman(o.mahAmount))} MAH
              <span style={{ color: 'var(--muted)', fontWeight: 500 }}> for </span>
              {fmtNum(fiatHuman(o.fiatAmountMinor))} {o.fiatCurrency}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right', alignSelf: 'end' }}>{railLabel(o.rail)}</div>
            {price != null && (
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)', fontFamily: '"DM Mono"' }}>
                {fmtNum(price, 4)} {o.fiatCurrency} / MAH · {fmtDate(o.createdAt)}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

function OrderDetail({ order: o, myAddresses, canTrade, connected, busy, onAction, onClose }: {
  order: P2POrder; myAddresses: string[]; canTrade: boolean; connected: boolean; busy: boolean
  onAction: (a: OrderAction) => void; onClose: () => void
}) {
  const acts = canTrade ? availableActions(o, myAddresses) : []
  const mine = new Set(myAddresses.map((a) => a.toLowerCase()))
  const iAmParty = mine.has(o.maker.toLowerCase()) || mine.has(o.taker.toLowerCase())
  const hasTaker = !/^0x0{40}$/i.test(o.taker)
  const [makerTrust, setMakerTrust] = useState<TrustScores | null | undefined>(undefined)
  const [takerTrust, setTakerTrust] = useState<TrustScores | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    fetchTrustScores(o.makerAin).then((s) => alive && setMakerTrust(s))
    if (hasTaker) fetchTrustScores(o.takerAin).then((s) => alive && setTakerTrust(s))
    return () => { alive = false }
  }, [o.id])

  const row = (k: string, v: React.ReactNode, mono = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line-2)', fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span style={{ color: 'var(--white)', textAlign: 'right', fontFamily: mono ? '"DM Mono"' : undefined, wordBreak: 'break-word' }}>{v}</span>
    </div>
  )

  const sell = isSellOffer(o)
  return (
    <div className="jlf-overlay open" onClick={onClose}>
      <div className="jlf-modal" style={{ maxWidth: 480, width: '100%', padding: 22, maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 18, color: 'var(--white)' }}>
            Order #{o.id.toString()} · {sell ? 'Sell offer' : 'Buy request'}
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={15} />
          </button>
        </div>

        {row('Status', <span style={{ color: STATUS_COLOR[o.status] }}>{statusLabel(o.status)}</span>)}
        {row('Amount', `${fmtNum(mahHuman(o.mahAmount))} MAH`, true)}
        {row('Price', `${fmtNum(fiatHuman(o.fiatAmountMinor))} ${o.fiatCurrency}`, true)}
        {unitPrice(o) != null && row('Rate', `${fmtNum(unitPrice(o)!, 4)} ${o.fiatCurrency} / MAH`, true)}
        {row('Payment', railLabel(o.rail))}
        {row(sell ? 'Seller' : 'Buyer', o.meta?.creatorHandle || o.makerAin || short(o.maker))}
        {hasTaker && row(sell ? 'Buyer' : 'Seller', o.takerAin || short(o.taker))}
        {row('Created', fmtDate(o.createdAt))}
        {o.payDeadline > 0 && row('Pay by', fmtDate(o.payDeadline))}
        {o.disputeDeadline > 0 && row('Dispute window ends', fmtDate(o.disputeDeadline))}
        {o.buyerBond > 0n && row('Buyer bond', `${fmtNum(mahHuman(o.buyerBond))} MAH`, true)}
        {/* Payment details are only for the two parties to the trade. */}
        {iAmParty && o.meta?.paymentDetails && row('Payment details', o.meta.paymentDetails)}
        {iAmParty && o.meta?.reference && row('Reference', o.meta.reference)}
        {iAmParty && o.meta?.receiptNote && row('Receipt note', o.meta.receiptNote)}

        <div style={{ ...sectionLabel, marginTop: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ShieldCheck size={13} /> {sell ? 'Seller' : 'Buyer'} trust
        </div>
        {makerTrust === undefined ? <div className="jlf-spin" /> : <TrustBars scores={makerTrust} />}
        {hasTaker && (
          <>
            <div style={{ ...sectionLabel, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldCheck size={13} /> {sell ? 'Buyer' : 'Seller'} trust
            </div>
            {takerTrust === undefined ? <div className="jlf-spin" /> : <TrustBars scores={takerTrust} />}
          </>
        )}

        {iAmParty && <DisputeSection order={o} />}

        {acts.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            {acts.map((a) => (
              <button
                key={a.action}
                className="jlf-action"
                disabled={busy}
                onClick={() => onAction(a.action)}
                style={a.secondary ? { flex: 1, background: 'transparent', color: 'var(--muted)', border: '1px solid var(--line)' } : { flex: 1 }}
              >{a.label}</button>
            ))}
          </div>
        )}
        {!canTrade && (
          <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 12, background: 'var(--leg)', border: '1px solid var(--line-2)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            {connected
              ? 'Trading here is rolling out — to trade on this order, open P2P in the Nuru app.'
              : 'Connect your wallet to trade on this order.'}
          </div>
        )}
      </div>
    </div>
  )
}

/** Dispute status, the arbiter's ruling and the thread (read-only) for a
 *  party to the order. Replying happens in Nuru's dispute chat. */
function DisputeSection({ order: o }: { order: P2POrder }) {
  const [d, setD] = useState<DisputeCase | null | undefined>(undefined)
  useEffect(() => watchDispute(o.id.toString(), setD), [o.id])
  if (d === undefined && o.status !== 4) return null
  if (d === null && o.status !== 4) return null

  const resolved = d?.status === 'resolved'
  const ruling = d?.messages.slice().reverse().find((m) => m.isRuling)
  const outcome = d?.resolutionOutcome ?? ruling?.rulingOutcome
  const roleLabel = (m: { senderRole: string }) =>
    m.senderRole === 'arbitrator' ? 'Arbiter' : m.senderRole === 'buyer' ? 'Buyer' : m.senderRole === 'seller' ? 'Seller' : m.senderRole

  return (
    <div style={{ marginTop: 18, padding: 14, borderRadius: 14, background: resolved ? 'rgba(54,211,153,.05)' : 'rgba(255,90,60,.05)', border: `1px solid ${resolved ? 'rgba(54,211,153,.2)' : 'rgba(255,90,60,.2)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 13, fontWeight: 600, color: resolved ? 'var(--green)' : 'var(--red)' }}>
        <Scale size={14} /> {resolved ? 'Dispute resolved' : 'Dispute open — awaiting arbiter'}
      </div>

      {resolved && outcome && (
        <div style={{ fontSize: 13, color: 'var(--white)', lineHeight: 1.5, marginBottom: 10 }}>
          Ruling: {outcome === 'buyer' ? 'MAH released to the buyer.' : 'MAH refunded to the seller.'}
          {ruling?.note ? <div style={{ marginTop: 4, color: 'var(--muted)' }}>{ruling.note}</div> : null}
        </div>
      )}

      {d === undefined && <div className="jlf-spin" />}
      {d === null && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>No dispute thread found for this order yet.</div>
      )}
      {d && d.messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
          {d.messages.map((m, i) => (
            <div key={i} style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--leg)', border: '1px solid var(--line-2)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 3 }}>
                {roleLabel(m)} · {m.senderAin} · {m.sentAt ? new Date(m.sentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--white)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
            </div>
          ))}
        </div>
      )}

      <a
        href={nuruDisputeChatLink(o.id.toString())}
        className="jlf-chip"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontWeight: 600 }}
      >
        <MessageCircle size={13} /> Reply in Nuru
      </a>
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted-2)' }}>
        Messages with the arbiter happen in the Nuru app's dispute chat.
      </div>
    </div>
  )
}
