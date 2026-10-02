import { describe, it, expect, vi } from 'vitest'
import { ethers } from 'ethers'

// p2pTx pulls in Firestore for its metadata writes; these tests only cover
// encoding, so stub the Firebase modules.
vi.mock('../../../services/firebase', () => ({ db: {} }))
vi.mock('../../../services/firebaseGuest', () => ({ ensureFirebaseGuest: async () => null }))

import EscrowAbi from '../abis/MAHP2PEscrow.json'
import CommitmentAbi from '../abis/CommitmentRegistry.json'
import { encodeCurrency, fiatToMinor, mahToWei, tx } from '../p2pTx'
import { availableActions } from '../orderActions'
import { P2P_ESCROW } from '../config'
import type { P2POrder } from '../p2pService'

const ESCROW = new ethers.Interface(EscrowAbi as any)
const AIN = 'VI05227152'
const AIN_HEX = '0x5649303532323731353200000000000000000000000000000000000000000000'
const ME = '0x58a672EAd62c18B368E9D052255CB9fE8Bbe61A2'
const OTHER = '0x5cDd9c3082e092B05665854e0a46E0Fa208d3c9A'
const ZERO = '0x0000000000000000000000000000000000000000'

describe('encoding (must match Nuru + on-chain data)', () => {
  it('encodes currency as bytes3 like the escrow stores it', () => {
    // Order #3 on-chain has fiatCurrency 0x554443 = "UDC" (USDC's code).
    expect(encodeCurrency('UDC')).toBe('0x554443')
    expect(encodeCurrency('ngn')).toBe(ethers.hexlify(ethers.toUtf8Bytes('NGN')))
    expect(encodeCurrency('USDC')).toBe(ethers.hexlify(ethers.toUtf8Bytes('USD'))) // cut to 3
  })

  it('converts MAH (6 dec) and fiat minor units', () => {
    expect(mahToWei(200)).toBe(200_000_000n)
    expect(mahToWei(0.1)).toBe(100_000n)
    expect(fiatToMinor(2.3)).toBe(230n)
  })

  it('builds createSellOffer calldata that decodes back to the inputs', () => {
    const t = tx.createSellOffer({
      ain: AIN, mahAmount: 200_000_000n, fiatAmountMinor: 230n, currency: 'UDC', rail: 0,
      paymentDetails: 'Network: Polygon\nAddress: 0xabc', reference: 'note', paymentWindowHours: 24,
    })
    expect(t.to).toBe(P2P_ESCROW)
    const d = ESCROW.decodeFunctionData('createSellOffer', t.data)
    expect(d[0]).toBe(AIN_HEX)
    expect(d[1]).toBe(200_000_000n)
    expect(d[2]).toBe(230n)
    expect(d[3]).toBe('0x554443')
    expect(d[4]).toBe(0n)
    expect(d[5]).toBe(ethers.keccak256(ethers.toUtf8Bytes('Network: Polygon\nAddress: 0xabc')))
    expect(d[6]).toBe(ethers.keccak256(ethers.toUtf8Bytes('note')))
    expect(d[7]).toBe(24n * 3600n) // payment window
    expect(d[8]).toBe(48n * 3600n) // dispute window default, as Nuru
  })

  it('uses Nuru defaults for empty receipt notes and expiry outcome', () => {
    const paid = ESCROW.decodeFunctionData('markPaid', tx.markPaid(7n, '').data)
    expect(paid[1]).toBe(ethers.keccak256(ethers.toUtf8Bytes('paid')))
    const exp = ESCROW.decodeFunctionData('expireUnpaid', tx.expire(7n).data)
    expect(exp[1]).toBe(ethers.keccak256(ethers.toUtf8Bytes('expired:7')))
  })

  it('bounds the escrow delegate like Nuru (10,000 MAH, domain 0, ~1 year)', () => {
    const d = new ethers.Interface(CommitmentAbi as any).decodeFunctionData('authorizeCommitmentDelegate', tx.authorizeDelegate(AIN).data)
    expect(d[1]).toBe(P2P_ESCROW)
    expect(d[2]).toBe(0n)
    expect(d[3]).toBe(10_000_000_000n)
    const days = (Number(d[4]) - Date.now() / 1000) / 86400
    expect(days).toBeGreaterThan(364)
    expect(days).toBeLessThan(366)
  })
})

function order(p: Partial<P2POrder>): P2POrder {
  return {
    id: 1n, orderType: 0, status: 0, maker: OTHER, makerAin: 'AA00000113', taker: ZERO, takerAin: null,
    mahAmount: 100_000_000n, fiatAmountMinor: 100n, fiatCurrency: 'NGN', rail: 1,
    createdAt: 0, payDeadline: 0, disputeDeadline: 0, buyerBond: 0n, ...p,
  }
}
const labels = (o: P2POrder, now?: number) => availableActions(o, [ME], now).map((a) => a.action)

describe('availableActions (Nuru role table)', () => {
  it('sell offer: browsing buyer can accept; seller can cancel', () => {
    expect(labels(order({}))).toEqual(['commit'])
    expect(labels(order({ maker: ME }))).toEqual(['cancel'])
  })

  it('taker-only actions are hidden from strangers', () => {
    expect(labels(order({ status: 1, taker: OTHER }))).toEqual([])
    expect(labels(order({ status: 1, taker: ME }))).toEqual(['markPaid', 'dispute'])
  })

  it('seller releases after payment; can close an overdue commit', () => {
    expect(labels(order({ maker: ME, status: 2, taker: OTHER }))).toEqual(['release', 'dispute'])
    expect(labels(order({ maker: ME, status: 1, taker: OTHER, payDeadline: 100 }), 200)).toEqual(['expire'])
    expect(labels(order({ maker: ME, status: 1, taker: OTHER, payDeadline: 300 }), 200)).toEqual(['dispute'])
  })

  it('buy request: a seller can accept; the poster can cancel and later mark paid', () => {
    expect(labels(order({ orderType: 1 }))).toEqual(['accept'])
    expect(labels(order({ orderType: 1, maker: ME }))).toEqual(['cancel'])
    expect(labels(order({ orderType: 1, maker: ME, status: 1, taker: OTHER }))).toEqual(['markPaid', 'dispute'])
  })

  it('closed orders offer nothing', () => {
    for (const status of [3, 5, 6, 7]) expect(labels(order({ maker: ME, status }))).toEqual([])
  })
})
