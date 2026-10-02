// src/lib/p2p/p2pService.ts
//
// Read side of the MAH P2P escrow — a port of Nuru's P2PService reads
// (nuru_ai lib/services/p2p_service.dart), so both apps show the same data:
// on-chain escrow balances/orders + trust scores, Firestore order metadata.
// Writes (deposit, offers, commit, release, …) are Phase 2.

import { ethers } from 'ethers'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../services/firebase'
import { ensureFirebaseGuest } from '../../services/firebaseGuest'
import { ALK_CHAIN_ID, ALK_RPC } from '../jollofAmm'
import EscrowAbi from './abis/MAHP2PEscrow.json'
import ReputationAbi from './abis/ReputationRegistry.json'
import CreditAbi from './abis/CreditworthinessRegistry.json'
import { ainToBytes32, bytes32ToAin, canonicalAin } from './ain'
import {
  CREDITWORTHINESS_REGISTRY,
  MAH_DECIMALS,
  OrderStatus,
  OrderType,
  P2P_ESCROW,
  P2P_META_COLLECTION,
  RAIL_LABEL,
  REPUTATION_REGISTRY,
  STATUS_LABEL,
} from './config'

// ── Types ────────────────────────────────────────────────────────────────────

export type EscrowBalance = { deposited: number; available: number; locked: number }

export type OrderMeta = {
  paymentDetails?: string
  reference?: string
  creatorAddress?: string
  creatorHandle?: string
  receiptNote?: string
}

export type P2POrder = {
  id: bigint
  orderType: number // 0 sell offer, 1 buy request
  status: number // OrderStatus
  maker: string
  makerAin: string | null
  taker: string
  takerAin: string | null
  mahAmount: bigint
  fiatAmountMinor: bigint
  fiatCurrency: string
  rail: number
  createdAt: number // unix seconds
  payDeadline: number
  disputeDeadline: number
  buyerBond: bigint
  meta?: OrderMeta
}

export type TrustScores = {
  reputationRegistered: boolean
  reputationScore: number // 0–1000
  reputationTier: number // 0–4
  suspended: boolean
  creditRegistered: boolean
  creditScore: number // 0–1000
  creditTier: number
  creditRestricted: boolean
}

/** Who trades in the escrow for this AIN. */
export type Participant = {
  address: string // escrow participant (the AIN controller)
  holder: 'key' | 'account' | 'unknown'
  controller: string | null // raw controllerOf() result
}

// ── Contracts ────────────────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | null = null
function provider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID, { staticNetwork: true })
  }
  return _provider
}

const escrow = () => new ethers.Contract(P2P_ESCROW, EscrowAbi as any, provider())
const reputation = () => new ethers.Contract(REPUTATION_REGISTRY, ReputationAbi as any, provider())
const credit = () => new ethers.Contract(CREDITWORTHINESS_REGISTRY, CreditAbi as any, provider())
// The AIN registry the ESCROW checks "P2P: not AIN controller" against —
// read from the escrow so we always agree with it (see config.ts note).
let _escrowRegistry: Promise<string> | null = null
async function registry() {
  if (!_escrowRegistry) _escrowRegistry = escrow().ainRegistry().then(String)
  const addr = await _escrowRegistry.catch((e) => { _escrowRegistry = null; throw e })
  return new ethers.Contract(addr, ['function controllerOf(bytes32 ain) view returns (address)'], provider())
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export const mahHuman = (wei: bigint): number => Number(ethers.formatUnits(wei, MAH_DECIMALS))
export const fiatHuman = (minor: bigint): number => Number(minor) / 100

export const statusLabel = (s: number) => STATUS_LABEL[s] ?? 'Unknown'
export const railLabel = (r: number) => RAIL_LABEL[r] ?? 'Other'
export const isSellOffer = (o: P2POrder) => o.orderType === OrderType.sellOffer
export const isClosed = (o: P2POrder) =>
  o.status === OrderStatus.released ||
  o.status === OrderStatus.refunded ||
  o.status === OrderStatus.cancelled ||
  o.status === OrderStatus.expired

/** Fiat per 1 MAH, or null when either side is zero. */
export function unitPrice(o: P2POrder): number | null {
  const mah = mahHuman(o.mahAmount)
  return mah > 0 ? fiatHuman(o.fiatAmountMinor) / mah : null
}

function decodeCurrency(bytes3: string): string {
  const h = bytes3.replace(/^0x/, '')
  let s = ''
  for (let i = 0; i + 1 < h.length; i += 2) {
    const c = parseInt(h.slice(i, i + 2), 16)
    if (c) s += String.fromCharCode(c)
  }
  return s.trim()
}

function parseOrder(raw: any): P2POrder {
  return {
    id: BigInt(raw.id),
    orderType: Number(raw.orderType),
    status: Number(raw.status),
    maker: String(raw.maker),
    makerAin: bytes32ToAin(raw.makerAIN),
    taker: String(raw.taker),
    takerAin: bytes32ToAin(raw.takerAIN),
    mahAmount: BigInt(raw.mahAmount),
    fiatAmountMinor: BigInt(raw.fiatAmountMinor),
    fiatCurrency: decodeCurrency(String(raw.fiatCurrency)),
    rail: Number(raw.rail),
    createdAt: Number(raw.createdAt),
    payDeadline: Number(raw.payDeadline),
    disputeDeadline: Number(raw.disputeDeadline),
    buyerBond: BigInt(raw.buyerBond),
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The escrow indexes balances/orders by the AIN **controller**, which can be
 * the Nuru Account (AA wallet) or the key — per the escrow's own
 * ainRegistry() (unlike Nuru's _loadP2PSource, which reads registry v1.4.0
 * and can disagree with the escrow). Falls back to the Nuru Account when the controller can't
 * be read or matches neither.
 */
export async function resolveParticipant(args: {
  ain: string | null
  aaWallet: string | null
  signer: string | null
}): Promise<Participant> {
  const account = (args.aaWallet || args.signer || '').trim()
  const key = (args.signer || '').trim()
  const ain = canonicalAin(args.ain)
  if (!ain) return { address: account, holder: account === key && key ? 'key' : 'unknown', controller: null }
  try {
    const controller = String(await (await registry()).controllerOf(ainToBytes32(ain))).toLowerCase()
    if (key && controller === key.toLowerCase()) return { address: key, holder: 'key', controller }
    if (account && controller === account.toLowerCase()) return { address: account, holder: 'account', controller }
    return { address: account, holder: 'unknown', controller }
  } catch {
    return { address: account, holder: 'unknown', controller: null }
  }
}

export async function fetchEscrowBalances(address: string): Promise<EscrowBalance> {
  if (!address) return { deposited: 0, available: 0, locked: 0 }
  const c = escrow()
  const [dep, avail, locked] = await Promise.all([
    c.mahBalanceOf(address),
    c.availableMAH(address),
    c.mahLockedOf(address),
  ])
  return { deposited: mahHuman(dep), available: mahHuman(avail), locked: mahHuman(locked) }
}

async function fetchOrdersByIds(ids: bigint[]): Promise<P2POrder[]> {
  const c = escrow()
  const raws = await Promise.all(ids.map((id) => c.getOrder(id)))
  return raws.map(parseOrder)
}

/** One order (with metadata), or null if it doesn't exist. */
export async function fetchOrderById(id: bigint): Promise<P2POrder | null> {
  try {
    const [o] = await withMetas(await fetchOrdersByIds([id]))
    return o && o.id === id ? o : null
  } catch {
    return null
  }
}

/** Orders where any of [addresses] is maker/taker (both the Nuru Account
 *  and the key, so orders made via either route show). Newest first. */
export async function fetchUserOrders(addresses: string[]): Promise<P2POrder[]> {
  const c = escrow()
  const uniq = Array.from(new Set(addresses.filter(Boolean).map((a) => a.toLowerCase())))
  const idLists = await Promise.all(uniq.map((a) => c.getUserOrderIds(a) as Promise<bigint[]>))
  const seen = new Set<string>()
  const ids: bigint[] = []
  for (const list of idLists) {
    for (const id of list) {
      const k = id.toString()
      if (!seen.has(k)) { seen.add(k); ids.push(BigInt(id)) }
    }
  }
  if (!ids.length) return []
  const orders = await withMetas(await fetchOrdersByIds(ids))
  return orders.sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0))
}

/** Marketplace: OPEN orders among the most recent [limit], excluding
 *  [excludeAddresses] as maker (your own). Newest first. */
export async function fetchOpenOrders(limit = 50, excludeAddresses: string[] = []): Promise<P2POrder[]> {
  const next = BigInt(await escrow().nextOrderId())
  if (next <= 1n) return []
  const last = next - 1n
  const first = last > BigInt(limit) ? last - BigInt(limit) + 1n : 1n
  const ids: bigint[] = []
  for (let i = last; i >= first; i--) ids.push(i)
  const excluded = new Set(excludeAddresses.filter(Boolean).map((a) => a.toLowerCase()))
  const open = (await fetchOrdersByIds(ids)).filter(
    (o) => o.status === OrderStatus.open && !excluded.has(o.maker.toLowerCase()),
  )
  return withMetas(open)
}

export async function fetchOrderMeta(orderId: string): Promise<OrderMeta | undefined> {
  try {
    await ensureFirebaseGuest()
    const snap = await getDoc(doc(db, P2P_META_COLLECTION, orderId))
    if (!snap.exists()) return undefined
    const d = snap.data() as Record<string, any>
    return {
      paymentDetails: d.paymentDetails ?? undefined,
      reference: d.reference ?? undefined,
      creatorAddress: d.creatorAddress ?? undefined,
      creatorHandle: d.creatorHandle ?? undefined,
      receiptNote: d.receiptNote ?? undefined,
    }
  } catch {
    return undefined
  }
}

async function withMetas(orders: P2POrder[]): Promise<P2POrder[]> {
  const metas = await Promise.all(orders.map((o) => fetchOrderMeta(o.id.toString())))
  return orders.map((o, i) => (metas[i] ? { ...o, meta: metas[i] } : o))
}

/** Reputation + credit scores for an AIN (0–1000 each). Null on failure. */
export async function fetchTrustScores(ain: string | null): Promise<TrustScores | null> {
  const canon = canonicalAin(ain)
  if (!canon) return null
  const ainB = ainToBytes32(canon)
  try {
    const rep = reputation()
    const cred = credit()
    const [repRegistered, creditRegistered] = (await Promise.all([
      rep.isRegistered(ainB),
      cred.hasRecord(ainB),
    ])) as [boolean, boolean]
    // Profiles revert for unregistered AINs — only read when registered.
    const [repProfile, creditProfile] = await Promise.all([
      repRegistered ? rep.getProfile(ainB) : Promise.resolve(null),
      creditRegistered ? cred.getCreditProfile(ainB) : Promise.resolve(null),
    ])
    return {
      reputationRegistered: repRegistered,
      reputationScore: repProfile ? Number(repProfile.globalScore) : 0,
      reputationTier: repProfile ? Number(repProfile.trustTier) : 0,
      suspended: repProfile ? Boolean(repProfile.suspended) : false,
      creditRegistered,
      creditScore: creditProfile ? Number(creditProfile.creditScore) : 0,
      creditTier: creditProfile ? Number(creditProfile.creditTier) : 0,
      creditRestricted: creditProfile ? Boolean(creditProfile.creditRestricted) : false,
    }
  } catch {
    return null
  }
}
