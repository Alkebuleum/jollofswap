// src/pages/P2P.tsx
//
// P2P market — Phase 1 (read-only). The same MAH escrow Nuru's P2P tab uses:
// escrow balance, trust scores, the open market and your orders, with an
// order detail view. Trading actions land in Phase 2; until then trades are
// placed in the Nuru app. Push alerts + dispute chat stay in Nuru.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { X, RefreshCw, ShieldCheck, Key, Wallet } from 'lucide-react'
import { useWalletConnection } from '../hooks/useWalletConnection'
import { useWalletMetaStore } from '../store/walletMetaStore'
import { useWcStore } from '../store/wcStore'
import { useConnectModalStore } from '../store/connectModalStore'
import {
  fetchEscrowBalances,
  fetchOpenOrders,
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

  const visibleMine = useMemo(
    () => (mine ?? []).filter((o) => showClosed || !isClosed(o)),
    [mine, showClosed],
  )
  const activeCount = (mine ?? []).filter((o) => !isClosed(o)).length

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px 64px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h1 style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 26, margin: 0, color: 'var(--white)' }}>P2P</h1>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, color: 'var(--gold)', background: 'rgba(247,181,59,.1)', border: '1px solid rgba(247,181,59,.25)' }}>
          Preview · read-only
        </span>
        <button
          onClick={() => load()}
          title="Refresh"
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--line)', borderRadius: 10, padding: 7, color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
        >
          <RefreshCw size={14} className={loading ? 'jlf-spin-icon' : undefined} />
        </button>
      </div>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 }}>
        Trade MAH for local currency with escrow protection. Trading on JollofSwap is coming soon — for now, place and manage trades in the Nuru app.
      </p>

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
          onClose={() => setSelected(null)}
        />
      )}
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

function OrderDetail({ order: o, myAddresses, onClose }: { order: P2POrder; myAddresses: string[]; onClose: () => void }) {
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

        <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 12, background: 'var(--leg)', border: '1px solid var(--line-2)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          To trade on this order, open P2P in the Nuru app. Alerts and dispute messages also arrive in Nuru.
        </div>
      </div>
    </div>
  )
}
