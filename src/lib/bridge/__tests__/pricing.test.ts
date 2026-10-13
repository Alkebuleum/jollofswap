import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  parseMahPricing,
  parseMahQuote,
  computeMahQuoteLocally,
  quoteMah,
  fetchMahPricing,
  MahPricingError,
  FALLBACK_MAH_PRICING,
} from '../pricing'

// Captured from https://bridge.jollofswap.com on 2026-10-13
const PRICING = {
  ok: true, asset: 'MAH', referenceAsset: 'USDC', corridor: 'polygon-usdc-mah',
  pricingType: 'configured_bridge_conversion', source: 'jollofswap-bridge-config', direction: 'USDC_TO_MAH',
  rate: { mahPerUsdc: '100', usdcPerMahApprox: '0.01' },
  fee: { bps: '10', minUsdc: '0.1', maxUsdc: '2.0' },
  decimals: { usdc: 6, mah: 6 },
  configurationLoadedAt: '2026-10-13T15:15:30.141Z', rateUpdateMechanism: 'service_restart', marketPrice: false,
}
const QUOTE_25 = {
  ...PRICING,
  inputUsdc: '25.0', feeUsdc: '0.1', netUsdc: '24.9', grossMah: '2500.0', netMah: '2490.0', feeMah: '10.0',
  quotedAt: '2026-10-13T15:29:23.405Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('parseMahPricing', () => {
  it('parses the live response shape', () => {
    const p = parseMahPricing(PRICING)
    expect(p.mahPerUsdc).toBe(100)
    expect(p.usdcPerMah).toBeCloseTo(0.01)
    expect(p.fee).toEqual({ bps: 10, minUsdc: 0.1, maxUsdc: 2 })
  })

  it('rejects ok:false, missing/zero rate, and malformed numbers', () => {
    expect(() => parseMahPricing({ ok: false, error: 'nope' })).toThrow('nope')
    expect(() => parseMahPricing({ ...PRICING, rate: undefined })).toThrow(MahPricingError)
    expect(() => parseMahPricing({ ...PRICING, rate: { mahPerUsdc: '0' } })).toThrow(MahPricingError)
    expect(() => parseMahPricing({ ...PRICING, rate: { mahPerUsdc: 'abc' } })).toThrow(MahPricingError)
    expect(() => parseMahPricing({ ...PRICING, fee: { bps: '10', minUsdc: '-1', maxUsdc: '2' } })).toThrow(MahPricingError)
    expect(() => parseMahPricing({ ...PRICING, asset: 'ALKE' })).toThrow(MahPricingError)
    expect(() => parseMahPricing(null)).toThrow(MahPricingError)
  })
})

describe('parseMahQuote', () => {
  it('parses the live quote shape', () => {
    const q = parseMahQuote(QUOTE_25)
    expect(q.netMah).toBe(2490)
    expect(q.feeUsdc).toBe(0.1)
  })

  it('rejects inconsistent quotes', () => {
    expect(() => parseMahQuote({ ...QUOTE_25, netMah: '9999' })).toThrow(MahPricingError)
    expect(() => parseMahQuote({ ok: false, error: 'Invalid USDC amount' })).toThrow('Invalid USDC amount')
  })
})

describe('local fallback quote', () => {
  const pricing = parseMahPricing(PRICING)

  it('matches the backend for min, bps and max fee tiers', () => {
    expect(computeMahQuoteLocally(25, pricing).netMah).toBeCloseTo(2490)       // min fee $0.10
    expect(computeMahQuoteLocally(5000, pricing).netMah).toBeCloseTo(499800)   // max fee $2.00
    expect(computeMahQuoteLocally(500, pricing).feeUsdc).toBeCloseTo(0.5)      // 10 bps
    expect(computeMahQuoteLocally(0.01, pricing).netMah).toBe(0)               // fee capped at input
  })

  it('defaults to 100 MAH per USDC when .env has no override', () => {
    expect(FALLBACK_MAH_PRICING.mahPerUsdc).toBeGreaterThan(0)
  })
})

describe('network handling', () => {
  it('quoteMah uses the API when it answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(QUOTE_25))))
    const q = await quoteMah(25, FALLBACK_MAH_PRICING)
    expect(q.fallback).toBe(false)
    expect(q.netMah).toBe(2490)
  })

  it('quoteMah falls back to local fee math when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const q = await quoteMah(25, parseMahPricing(PRICING))
    expect(q.fallback).toBe(true)
    expect(q.netMah).toBeCloseTo(2490)
  })

  it('fetchMahPricing surfaces HTTP errors and non-JSON bodies as MahPricingError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })))
    await expect(fetchMahPricing()).rejects.toBeInstanceOf(MahPricingError)
  })
})
