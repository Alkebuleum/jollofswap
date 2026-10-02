// src/lib/p2p/p2pTx.ts
//
// Write side of the MAH P2P escrow (Phase 2) — calldata, the extra reads the
// trading flows need, and the Firestore writes. Ported from Nuru's
// P2PService encoders + p2p_tab.dart flows so both apps produce identical
// transactions and metadata. Orchestration lives in useP2PActions.ts.

import { ethers } from 'ethers'
import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { ensureFirebaseGuest } from '../../services/firebaseGuest'
import { ALK_CHAIN_ID, ALK_RPC } from '../jollofAmm'
import EscrowAbi from './abis/MAHP2PEscrow.json'
import ReputationAbi from './abis/ReputationRegistry.json'
import CreditAbi from './abis/CreditworthinessRegistry.json'
import CommitmentAbi from './abis/CommitmentRegistry.json'
import RiskAbi from './abis/RiskPolicyManager.json'
import { ainToBytes32 } from './ain'
import {
  CREDITWORTHINESS_REGISTRY,
  P2P_COMMITMENT_REGISTRY,
  P2P_ESCROW,
  P2P_EVENTS_COLLECTION,
  P2P_META_COLLECTION,
  P2P_RISK_POLICY_MANAGER,
  REPUTATION_REGISTRY,
} from './config'

export const MAH_TOKEN =
  (import.meta.env.VITE_TOKEN_MAH_ALK as string) || '0x9983Cf46eeC1A7e75639eA1142410086b874dbf6'

/** CommitmentRegistry domain id for P2P (Nuru: commitmentDomainP2P = 0). */
export const COMMITMENT_DOMAIN_P2P = 0

export const MAX_UINT256 = (1n << 256n) - 1n

// Gas limits — same as Nuru (p2p_tab.dart).
export const GAS = {
  approve: 120_000,
  deposit: 150_000,
  withdraw: 120_000,
  transfer: 100_000,
  createOrder: 700_000,
  orderAction: 300_000,
  commit: 1_000_000, // crosses CommitmentRegistry + RiskPolicyManager (~599k seen)
  accept: 1_000_000,
  release: 1_500_000, // settles both commitments + reputation + transfers
  expire: 1_500_000,
  setup: 150_000,
} as const

export const P2P_CONSENT_KEY = 'p2p_terms_accepted_v1' // same key name as Nuru

const ESCROW = new ethers.Interface(EscrowAbi as any)
const REPUTATION = new ethers.Interface(ReputationAbi as any)
const CREDIT = new ethers.Interface(CreditAbi as any)
const COMMITMENT = new ethers.Interface(CommitmentAbi as any)
const ERC20 = new ethers.Interface([
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
])

let _provider: ethers.JsonRpcProvider | null = null
function provider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID, { staticNetwork: true })
  return _provider
}

export type Tx = { to: string; data: string; value: bigint; gas: number }

// ── Hashing / encoding helpers (match Nuru's P2PService) ────────────────────

const keccakText = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s))

/** bytes3 currency: upper-cased, space-padded / cut to 3 chars. */
export function encodeCurrency(code: string): string {
  const c = code.toUpperCase().padEnd(3).slice(0, 3)
  return ethers.hexlify(ethers.toUtf8Bytes(c))
}

export const mahToWei = (amount: number): bigint => BigInt(Math.round(amount * 1e6))
export const fiatToMinor = (amount: number): bigint => BigInt(Math.round(amount * 100))

// ── Calldata builders ────────────────────────────────────────────────────────

export const tx = {
  approveMah: (amount = MAX_UINT256): Tx => ({
    to: MAH_TOKEN, value: 0n, gas: GAS.approve,
    data: ERC20.encodeFunctionData('approve', [P2P_ESCROW, amount]),
  }),
  approveBond: (bondToken: string, amount = MAX_UINT256): Tx => ({
    to: bondToken, value: 0n, gas: GAS.approve,
    data: ERC20.encodeFunctionData('approve', [P2P_ESCROW, amount]),
  }),
  transferMah: (to: string, amount: bigint): Tx => ({
    to: MAH_TOKEN, value: 0n, gas: GAS.transfer,
    data: ERC20.encodeFunctionData('transfer', [to, amount]),
  }),
  deposit: (amount: bigint): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.deposit,
    data: ESCROW.encodeFunctionData('depositMAH', [amount]),
  }),
  withdraw: (amount: bigint): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.withdraw,
    data: ESCROW.encodeFunctionData('withdrawMAH', [amount]),
  }),
  createSellOffer: (a: {
    ain: string; mahAmount: bigint; fiatAmountMinor: bigint; currency: string; rail: number
    paymentDetails: string; reference: string; paymentWindowHours: number; disputeWindowHours?: number
  }): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.createOrder,
    data: ESCROW.encodeFunctionData('createSellOffer', [
      ainToBytes32(a.ain), a.mahAmount, a.fiatAmountMinor, encodeCurrency(a.currency), a.rail,
      keccakText(a.paymentDetails), keccakText(a.reference),
      BigInt(a.paymentWindowHours * 3600), BigInt((a.disputeWindowHours ?? 48) * 3600),
    ]),
  }),
  createBuyRequest: (a: {
    ain: string; mahAmount: bigint; fiatAmountMinor: bigint; currency: string; rail: number
    reference: string; paymentWindowHours: number; disputeWindowHours?: number
  }): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.createOrder,
    data: ESCROW.encodeFunctionData('createBuyRequest', [
      ainToBytes32(a.ain), a.mahAmount, a.fiatAmountMinor, encodeCurrency(a.currency), a.rail,
      keccakText(a.reference),
      BigInt(a.paymentWindowHours * 3600), BigInt((a.disputeWindowHours ?? 48) * 3600),
    ]),
  }),
  commitToSellOffer: (orderId: bigint, buyerAin: string): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.commit,
    data: ESCROW.encodeFunctionData('commitToSellOffer', [orderId, ainToBytes32(buyerAin)]),
  }),
  acceptBuyRequest: (orderId: bigint, sellerAin: string, paymentDetails: string): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.accept,
    data: ESCROW.encodeFunctionData('acceptBuyRequest', [orderId, ainToBytes32(sellerAin), keccakText(paymentDetails)]),
  }),
  markPaid: (orderId: bigint, receiptNote: string): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.orderAction,
    data: ESCROW.encodeFunctionData('markPaid', [orderId, keccakText(receiptNote || 'paid')]),
  }),
  release: (orderId: bigint, receiptNote: string): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.release,
    data: ESCROW.encodeFunctionData('releaseToBuyer', [orderId, keccakText(receiptNote || 'released')]),
  }),
  cancel: (orderId: bigint): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.orderAction,
    data: ESCROW.encodeFunctionData('cancelOpenOrder', [orderId]),
  }),
  expire: (orderId: bigint): Tx => ({
    to: P2P_ESCROW, value: 0n, gas: GAS.expire,
    data: ESCROW.encodeFunctionData('expireUnpaid', [orderId, keccakText(`expired:${orderId}`)]),
  }),
  registerReputation: (ain: string): Tx => ({
    to: REPUTATION_REGISTRY, value: 0n, gas: GAS.setup,
    data: REPUTATION.encodeFunctionData('registerMyIdentity', [ainToBytes32(ain)]),
  }),
  registerCredit: (ain: string): Tx => ({
    to: CREDITWORTHINESS_REGISTRY, value: 0n, gas: GAS.setup,
    data: CREDIT.encodeFunctionData('registerMyCreditProfile', [ainToBytes32(ain)]),
  }),
  /** Bounded delegate grant, same as Nuru: 10,000 MAH for 365 days. */
  authorizeDelegate: (ain: string): Tx => ({
    to: P2P_COMMITMENT_REGISTRY, value: 0n, gas: GAS.setup,
    data: COMMITMENT.encodeFunctionData('authorizeCommitmentDelegate', [
      ainToBytes32(ain), P2P_ESCROW, COMMITMENT_DOMAIN_P2P,
      10_000n * 1_000_000n,
      BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600),
    ]),
  }),
}

// ── Reads used by the flows ──────────────────────────────────────────────────

export type TrustReadiness = {
  reputationRegistered: boolean
  reputationSuspended: boolean
  creditRegistered: boolean
  creditRestricted: boolean
  domainAllowed: boolean
  delegateAuthorized: boolean
}

export const needsSetup = (t: TrustReadiness) =>
  !t.reputationRegistered || !t.creditRegistered || !t.delegateAuthorized

export async function fetchTrustReadiness(ain: string): Promise<TrustReadiness> {
  const a = ainToBytes32(ain)
  const p = provider()
  const rep = new ethers.Contract(REPUTATION_REGISTRY, ReputationAbi as any, p)
  const cred = new ethers.Contract(CREDITWORTHINESS_REGISTRY, CreditAbi as any, p)
  const risk = new ethers.Contract(P2P_RISK_POLICY_MANAGER, RiskAbi as any, p)
  const comm = new ethers.Contract(P2P_COMMITMENT_REGISTRY, CommitmentAbi as any, p)
  const [repReg, repSusp, credReg, credRestr, domain, delegate] = await Promise.all([
    rep.isRegistered(a),
    rep.isSuspended(a),
    cred.hasRecord(a),
    cred.isCreditRestricted(a),
    risk.canAccessDomain(a, COMMITMENT_DOMAIN_P2P),
    comm.isDelegateAuthorized(a, P2P_ESCROW, COMMITMENT_DOMAIN_P2P, 1n),
  ])
  return {
    reputationRegistered: Boolean(repReg),
    reputationSuspended: Boolean(repSusp),
    creditRegistered: Boolean(credReg),
    creditRestricted: Boolean(credRestr),
    domainAllowed: Boolean(domain),
    delegateAuthorized: Boolean(delegate),
  }
}

export async function fetchMahBalance(address: string): Promise<bigint> {
  const c = new ethers.Contract(MAH_TOKEN, ERC20, provider())
  return BigInt(await c.balanceOf(address))
}

export async function fetchAllowance(token: string, owner: string): Promise<bigint> {
  const c = new ethers.Contract(token, ERC20, provider())
  return BigInt(await c.allowance(owner, P2P_ESCROW))
}

/** Max trade for this AIN on [rail], in 6-dec MAH units (contract stores
 *  18-dec). 0n = unknown / no limit info — callers skip the check then. */
export async function fetchMaxTrade(ain: string, rail: number): Promise<bigint> {
  try {
    const risk = new ethers.Contract(P2P_RISK_POLICY_MANAGER, RiskAbi as any, provider())
    const raw = BigInt(await risk.getMaxP2PTradeAmount(ainToBytes32(ain), rail))
    return raw / 10n ** 12n
  } catch {
    return 0n
  }
}

export async function fetchBondToken(): Promise<string> {
  const c = new ethers.Contract(P2P_ESCROW, EscrowAbi as any, provider())
  return String(await c.bondToken())
}

export async function quoteBuyerBond(ain: string, rail: number, mahAmount: bigint): Promise<bigint> {
  try {
    const c = new ethers.Contract(P2P_ESCROW, EscrowAbi as any, provider())
    return BigInt(await c.quoteBuyerBond(ainToBytes32(ain), rail, mahAmount))
  } catch {
    return 0n
  }
}

export async function fetchNextOrderId(): Promise<bigint> {
  const c = new ethers.Contract(P2P_ESCROW, EscrowAbi as any, provider())
  return BigInt(await c.nextOrderId())
}

// ── Firestore (shared with Nuru) ─────────────────────────────────────────────

export async function saveOrderMeta(orderId: string, m: {
  paymentDetails: string; reference: string; creatorAddress: string; creatorHandle?: string | null
  fiatCurrency: string; rail: number; isSell: boolean
}): Promise<void> {
  await ensureFirebaseGuest()
  await setDoc(doc(db, P2P_META_COLLECTION, orderId), {
    paymentDetails: m.paymentDetails,
    reference: m.reference,
    creatorAddress: m.creatorAddress.toLowerCase(),
    ...(m.creatorHandle ? { creatorHandle: m.creatorHandle } : {}),
    fiatCurrency: m.fiatCurrency,
    rail: m.rail,
    isSell: m.isSell,
    createdAt: serverTimestamp(),
  })
}

export async function updateAcceptanceMeta(orderId: string, paymentDetails: string, sellerAddress: string) {
  await ensureFirebaseGuest()
  await setDoc(doc(db, P2P_META_COLLECTION, orderId), {
    paymentDetails,
    sellerAddress: sellerAddress.toLowerCase(),
    acceptedAt: serverTimestamp(),
  }, { merge: true })
}

export async function updateReceiptNote(orderId: string, receiptNote: string) {
  await ensureFirebaseGuest()
  await setDoc(doc(db, P2P_META_COLLECTION, orderId), { receiptNote }, { merge: true })
}

/**
 * Alerts the counterparty. Nuru's NotificationService watches `p2p_events`
 * for its AIN and pushes a notification — so every JollofSwap action that
 * Nuru would notify about MUST write this, or the other side never hears.
 * Best-effort: never fails the trade.
 */
export async function sendP2PEvent(e: {
  targetAin: string; senderAin: string; orderId: string; action: string
  mahAmount?: string; fiatCurrency?: string; fiatAmountMinor?: number
}): Promise<void> {
  try {
    await ensureFirebaseGuest()
    await addDoc(collection(db, P2P_EVENTS_COLLECTION), {
      targetAin: e.targetAin.toUpperCase(),
      senderAin: e.senderAin.toUpperCase(),
      orderId: e.orderId,
      action: e.action,
      mahAmount: e.mahAmount ?? '',
      fiatCurrency: e.fiatCurrency ?? '',
      fiatAmountMinor: e.fiatAmountMinor ?? 0,
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    console.warn('[P2P] sendP2PEvent failed', err)
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Same mapping as Nuru's _friendlyError for known escrow reverts. */
export function friendlyP2PError(e: any): string {
  const s = String(e?.shortMessage || e?.reason || e?.message || e || '')
  if (s.includes('P2P: domain blocked')) return 'P2P trading is not yet enabled for your account. Contact support.'
  if (s.includes('P2P: above risk limit')) return 'Amount exceeds your P2P risk limit. Try a smaller amount.'
  if (s.includes('P2P: delegate not authorized')) return 'P2P setup is incomplete. Try the action again to authorize.'
  if (s.includes('P2P: insufficient MAH')) return 'Insufficient MAH in escrow. Deposit more to continue.'
  if (s.includes('P2P: not AIN controller')) return 'Your connected key/account is not the AIN controller for this identity.'
  if (s.includes('P2P: insufficient available')) return 'Not enough available MAH in your P2P balance (some may be locked in trades).'
  if (s.includes('P2P: not open')) return 'This order is no longer open — refresh to see its current status.'
  if (s.includes('insufficient allowance') || s.includes('exceeds allowance')) return 'Approve MAH for this action first.'
  if (s.includes('exceeds balance')) return 'You do not have enough MAH for this action.'
  if (/user rejected|rejected|denied|cancel/i.test(s)) return 'Cancelled.'
  return s.length > 220 ? s.slice(0, 220) + '…' : s || 'Something went wrong.'
}
