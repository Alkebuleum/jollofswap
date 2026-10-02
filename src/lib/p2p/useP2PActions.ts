// src/lib/p2p/useP2PActions.ts
//
// P2P trading flows (Phase 2) — step-for-step ports of Nuru's p2p_tab.dart
// handlers (_onDepositTap, _onSellTap, _onBuyTap, _onCommitToSellOffer, …).
//
// Every escrow tx is sent AS THE AIN CONTROLLER (Participant.address):
//   • controller = key         → direct send from the key   (skipAaWrap)
//   • controller = Nuru Account → wrapped through the account (Nuru relays
//                                 it for a non-primary key)
// Txs go one at a time, each confirmed before the next (approve → deposit):
// back-to-back sends race on the key's nonce / the relay's signer nonce.

import { useCallback, useState } from 'react'
import { useSignerSession } from '../../hooks/useSignerSession'
import { ALK_CHAIN_ID } from '../jollofAmm'
import type { P2POrder, Participant } from './p2pService'
import {
  fetchAllowance,
  fetchBondToken,
  fetchMahBalance,
  fetchMaxTrade,
  fetchNextOrderId,
  fetchTrustReadiness,
  fiatToMinor,
  friendlyP2PError,
  mahToWei,
  MAH_TOKEN,
  quoteBuyerBond,
  saveOrderMeta,
  sendP2PEvent,
  openDisputeCase,
  tx,
  updateAcceptanceMeta,
  updateReceiptNote,
  type TrustReadiness,
  type Tx,
} from './p2pTx'

const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const APP_NAME = (import.meta.env.VITE_APP_NAME as string) ?? 'JollofSwap'

export type OrderForm = {
  mahAmount: number
  fiatAmount: number
  /** 3-char on-chain code (NGN, or a crypto code like UDC for USDC). */
  currency: string
  /** What the user picked, stored in Firestore for display (e.g. USDC). */
  currencyDisplay: string
  rail: number
  paymentDetails: string // sell offers only
  reference: string
  paymentWindowHours: number
}

export type P2PContext = {
  ain: string | null
  handle: string | null
  participant: Participant | null
  /** Nuru Account (AA wallet), when distinct from the key. */
  aaWallet: string | null
  /** Every address of this user — decides maker vs taker on orders. */
  myAddresses: string[]
}

const fmt2 = (n: number) => n.toFixed(2)

export function useP2PActions(ctx: P2PContext, onChanged: () => void) {
  const { sessionSendTransactions } = useSignerSession()
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requireAin = () => {
    if (!ctx.ain) throw new Error('No identity (AIN) found for this connection.')
    return ctx.ain
  }
  const requireParticipant = () => {
    const p = ctx.participant
    if (!p || !p.address) throw new Error('Connect your wallet first.')
    if (p.holder === 'unknown') {
      throw new Error(
        "Neither your key nor your Nuru Account is this identity's AIN controller, so it can't trade in the escrow.",
      )
    }
    return p
  }

  /** Sends ONE tx and waits for it. as='participant' → as the AIN
   *  controller; as='account' → wrapped through the Nuru Account. */
  const sendOne = useCallback(async (t: Tx, label: string, as: 'participant' | 'account' = 'participant') => {
    const p = requireParticipant()
    const skipAaWrap = as === 'participant' && p.holder === 'key'
    setInfo(`${label} — confirm in your wallet…`)
    const results = await sessionSendTransactions(
      {
        chainId: ALK_CHAIN_ID,
        txs: [{ to: t.to, data: t.data, value: t.value, gas: t.gas }],
        failFast: true,
      } as any,
      { app: APP_NAME, amvaultUrl: AMVAULT_URL, skipAaWrap },
      label,
    )
    const r = results?.[0]
    if (!r || r.ok === false) throw new Error(r?.error || `${label} failed`)
    return r.txHash as string
  }, [sessionSendTransactions, ctx.participant]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Runs a flow with busy/info/error handling, then refreshes the page. */
  const run = useCallback(async (flow: () => Promise<string | void>) => {
    setBusy(true); setError(null); setInfo(null)
    try {
      const done = await flow()
      setInfo(done || 'Done ✅')
      onChanged()
      return true
    } catch (e) {
      setError(friendlyP2PError(e)); setInfo(null)
      return false
    } finally {
      setBusy(false)
    }
  }, [onChanged])

  /** Firestore metadata is written AFTER the on-chain tx succeeded, so a
   *  failure here must not read as "the trade failed" — say what's missing. */
  const saveMeta = async (write: () => Promise<void>, what: string): Promise<string> => {
    try { await write(); return '' } catch (e) {
      console.warn('[P2P] metadata write failed', e)
      return `
⚠️ Done on-chain, but saving ${what} failed — check your connection and contact support if the other party can't see it.`
    }
  }

  const counterpartyAin = (o: P2POrder) => {
    const mine = new Set(ctx.myAddresses.map((a) => a.toLowerCase()))
    return mine.has(o.maker.toLowerCase()) ? o.takerAin : o.makerAin
  }

  /** Nuru pushes the alert from this p2p_events doc (see p2pTx.sendP2PEvent). */
  const notify = (o: P2POrder, action: string) => {
    const target = counterpartyAin(o)
    if (!target || !ctx.ain) return
    void sendP2PEvent({
      targetAin: target,
      senderAin: ctx.ain,
      orderId: o.id.toString(),
      action,
      mahAmount: fmt2(Number(o.mahAmount) / 1e6),
      fiatCurrency: o.fiatCurrency,
      fiatAmountMinor: Number(o.fiatAmountMinor),
    })
  }

  // ── Readiness ──────────────────────────────────────────────────────────────

  const readiness = useCallback(async (): Promise<TrustReadiness> => {
    return fetchTrustReadiness(requireAin())
  }, [ctx.ain]) // eslint-disable-line react-hooks/exhaustive-deps

  /** One-time trust-layer setup — only the missing steps, in Nuru's order. */
  const setup = (t: TrustReadiness) => run(async () => {
    const ain = requireAin()
    if (!t.reputationRegistered) await sendOne(tx.registerReputation(ain), 'Register reputation profile')
    if (!t.creditRegistered) await sendOne(tx.registerCredit(ain), 'Register credit profile')
    if (!t.delegateAuthorized) await sendOne(tx.authorizeDelegate(ain), 'Authorize P2P escrow')
    return 'P2P setup complete ✅'
  })

  // ── Escrow balance ─────────────────────────────────────────────────────────

  /** Wallet MAH the deposit can draw from (key + Nuru Account when the key
   *  is the controller — Nuru moves the shortfall from the account first). */
  const depositSources = useCallback(async () => {
    const p = requireParticipant()
    const holderBal = await fetchMahBalance(p.address)
    const acct = ctx.aaWallet
    const fromAccount = p.holder === 'key' && !!acct && acct.toLowerCase() !== p.address.toLowerCase()
    const accountBal = fromAccount ? await fetchMahBalance(acct!) : 0n
    return { holderBal, accountBal, fromAccount }
  }, [ctx.participant, ctx.aaWallet]) // eslint-disable-line react-hooks/exhaustive-deps

  const deposit = (amount: number) => run(async () => {
    const p = requireParticipant()
    const wei = mahToWei(amount)
    if (wei <= 0n) throw new Error('Enter an amount.')
    const { holderBal, accountBal, fromAccount } = await depositSources()
    if (wei > holderBal) {
      const needed = wei - holderBal
      if (!fromAccount || accountBal < needed) {
        throw new Error(`Not enough MAH in your wallet for ${fmt2(amount)} MAH.`)
      }
      // Key is the controller but holds too little: move the shortfall from
      // the Nuru Account to the key first (same as Nuru).
      await sendOne(tx.transferMah(p.address, needed), 'Move MAH to your key', 'account')
    }
    if ((await fetchAllowance(MAH_TOKEN, p.address)) < wei) {
      await sendOne(tx.approveMah(), 'Approve MAH')
    }
    await sendOne(tx.deposit(wei), 'Add MAH to P2P')
    return `${fmt2(amount)} MAH added to your P2P balance ✅`
  })

  const withdraw = (amount: number) => run(async () => {
    const wei = mahToWei(amount)
    if (wei <= 0n) throw new Error('Enter an amount.')
    await sendOne(tx.withdraw(wei), 'Reclaim MAH')
    return `${fmt2(amount)} MAH reclaimed ✅`
  })

  // ── Create orders ──────────────────────────────────────────────────────────

  const checkRailLimit = async (ain: string, rail: number, wei: bigint) => {
    const max = await fetchMaxTrade(ain, rail)
    if (max > 0n && wei > max) {
      throw new Error(`Amount exceeds your P2P limit for this payment method. Max: ${fmt2(Number(max) / 1e6)} MAH.`)
    }
  }

  /** Approves the buyer bond if one is quoted (0 at launch). */
  const ensureBond = async (ain: string, rail: number, wei: bigint, holder: string) => {
    const bond = await quoteBuyerBond(ain, rail, wei)
    if (bond <= 0n) return
    const bondToken = await fetchBondToken()
    if ((await fetchMahBalance(holder)) < bond) {
      throw new Error(`This trade needs a ${fmt2(Number(bond) / 1e6)} MAH commitment bond. Get some MAH first.`)
    }
    if ((await fetchAllowance(bondToken, holder)) < bond) {
      await sendOne(tx.approveBond(bondToken), 'Approve commitment bond')
    }
  }

  const createSellOffer = (f: OrderForm) => run(async () => {
    const ain = requireAin(); const p = requireParticipant()
    const wei = mahToWei(f.mahAmount)
    await checkRailLimit(ain, f.rail, wei)
    const nextId = await fetchNextOrderId() // pre-read, as Nuru, to key the metadata
    await sendOne(tx.createSellOffer({
      ain, mahAmount: wei, fiatAmountMinor: fiatToMinor(f.fiatAmount), currency: f.currency, rail: f.rail,
      paymentDetails: f.paymentDetails, reference: f.reference, paymentWindowHours: f.paymentWindowHours,
    }), 'Create sell offer')
    const warn = await saveMeta(() => saveOrderMeta(nextId.toString(), {
      paymentDetails: f.paymentDetails, reference: f.reference, creatorAddress: p.address,
      creatorHandle: ctx.handle, fiatCurrency: f.currencyDisplay, rail: f.rail, isSell: true,
    }), 'your payment details')
    return 'Sell offer created ✅' + warn
  })

  const createBuyRequest = (f: OrderForm) => run(async () => {
    const ain = requireAin(); const p = requireParticipant()
    const wei = mahToWei(f.mahAmount)
    await checkRailLimit(ain, f.rail, wei)
    await ensureBond(ain, f.rail, wei, p.address)
    const nextId = await fetchNextOrderId()
    await sendOne(tx.createBuyRequest({
      ain, mahAmount: wei, fiatAmountMinor: fiatToMinor(f.fiatAmount), currency: f.currency, rail: f.rail,
      reference: f.reference, paymentWindowHours: f.paymentWindowHours,
    }), 'Create buy request')
    const warn = await saveMeta(() => saveOrderMeta(nextId.toString(), {
      paymentDetails: '', reference: f.reference, creatorAddress: p.address,
      creatorHandle: ctx.handle, fiatCurrency: f.currencyDisplay, rail: f.rail, isSell: false,
    }), 'the order details')
    return 'Buy request created ✅' + warn
  })

  // ── Order actions ──────────────────────────────────────────────────────────

  /** Buyer takes a sell offer. */
  const commit = (o: P2POrder) => run(async () => {
    const ain = requireAin(); const p = requireParticipant()
    await ensureBond(ain, o.rail, o.mahAmount, p.address)
    await sendOne(tx.commitToSellOffer(o.id, ain), 'Accept & buy')
    notify(o, 'committed')
    return 'Committed — send payment to the seller, then mark it paid ✅'
  })

  /** Seller fills a buy request (needs the MAH in escrow). */
  const accept = (o: P2POrder, paymentDetails: string) => run(async () => {
    const ain = requireAin(); const p = requireParticipant()
    if (!paymentDetails.trim()) throw new Error('Add your payment details so the buyer can pay you.')
    await sendOne(tx.acceptBuyRequest(o.id, ain, paymentDetails), 'Accept & sell')
    const warn = await saveMeta(() => updateAcceptanceMeta(o.id.toString(), paymentDetails, p.address), 'your payment details')
    notify(o, 'accepted')
    return 'Accepted — the buyer will send payment ✅' + warn
  })

  const markPaid = (o: P2POrder, receipt: string) => run(async () => {
    await sendOne(tx.markPaid(o.id, receipt), 'Mark paid')
    const warn = await saveMeta(() => updateReceiptNote(o.id.toString(), receipt), 'your receipt note')
    notify(o, 'markPaid')
    return 'Marked paid — waiting for the seller to release ✅' + warn
  })

  const release = (o: P2POrder) => run(async () => {
    // Re-check trust right before releasing funds (same as Nuru).
    const t = await fetchTrustReadiness(requireAin())
    if (t.reputationSuspended) throw new Error('Your account has been suspended — contact support.')
    if (t.creditRestricted) throw new Error('Your account has credit restrictions — contact support.')
    await sendOne(tx.release(o.id, o.meta?.receiptNote ?? ''), 'Release MAH')
    notify(o, 'release')
    return 'MAH released to the buyer ✅'
  })

  /** Either party, on a committed/paid trade: on-chain dispute + the
   *  Firestore thread Nuru's arbiters work from (same as Nuru). */
  const openDispute = (o: P2POrder, evidence: string) => run(async () => {
    const myAin = requireAin()
    if (!evidence.trim()) throw new Error('Describe the problem — the arbiter decides from this.')
    await sendOne(tx.openDispute(o.id, evidence), 'Open dispute')
    const sell = o.orderType === 0
    const buyerAin = (sell ? o.takerAin : o.makerAin) ?? ''
    const sellerAin = (sell ? o.makerAin : o.takerAin) ?? ''
    const warn = await saveMeta(() => openDisputeCase({
      orderId: o.id.toString(), buyerAin, sellerAin, openedByAin: myAin, evidence: evidence.trim(),
    }), 'the dispute thread')
    notify(o, 'disputed')
    return 'Dispute opened — an arbiter will review your evidence ✅' + warn
  })

  const cancel = (o: P2POrder) => run(async () => {
    await sendOne(tx.cancel(o.id), 'Cancel order')
    notify(o, 'cancel')
    return 'Order cancelled ✅'
  })

  const expire = (o: P2POrder) => run(async () => {
    await sendOne(tx.expire(o.id), 'Close overdue order')
    notify(o, 'expire')
    return 'Order closed ✅'
  })

  return {
    busy, info, error,
    clearMessages: () => { setInfo(null); setError(null) },
    readiness, setup, depositSources,
    deposit, withdraw, createSellOffer, createBuyRequest,
    commit, accept, markPaid, release, openDispute, cancel, expire,
  }
}

export { availableActions, type OrderAction } from './orderActions'
