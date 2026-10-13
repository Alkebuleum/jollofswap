// src/lib/bridge/pricing.ts
//
// Client for the bridge's public MAH pricing endpoints:
//   GET /v1/pricing/mah                       → configured USDC→MAH bridge conversion
//   GET /v1/pricing/mah/quote?amountUsdc=25   → conversion amounts including bridge fees
//
// These are the bridge's *operational* conversion settings (what the USDC→MAH
// corridor pays out), not an independent MAH/USD market price — MAH is not a
// stablecoin or pegged asset. The backend owns the rate and fees; the frontend
// never hardcodes them.

import { BRIDGE_API } from './config'

export type MahPricing = {
  mahPerUsdc: number
  usdcPerMah: number
  fee: { bps: number; minUsdc: number; maxUsdc: number }
  configurationLoadedAt: string
}

export type MahQuote = {
  inputUsdc: number
  feeUsdc: number
  netUsdc: number
  grossMah: number
  netMah: number
  feeMah: number
  quotedAt: string
}

// Fallback used only when the pricing API can't be reached or returns garbage.
// Keep these in sync with the bridge's configuration (VITE_* in .env).
export const FALLBACK_MAH_PRICING: MahPricing = (() => {
  const mahPerUsdc = Number(import.meta.env.VITE_MAH_PER_USDC ?? 100)
  return {
    mahPerUsdc,
    usdcPerMah: 1 / mahPerUsdc,
    fee: {
      bps: Number(import.meta.env.VITE_BRIDGE_FEE_BPS ?? 10),
      minUsdc: Number(import.meta.env.VITE_BRIDGE_FEE_MIN_USD ?? 0.10),
      maxUsdc: Number(import.meta.env.VITE_BRIDGE_FEE_MAX_USD ?? 2.0),
    },
    configurationLoadedAt: '',
  }
})()

// Local mirror of the backend's fee math — only used when the quote endpoint
// is unreachable. Fee is bps of the input, clamped to [min, max] and to the input.
export function computeMahQuoteLocally(amountUsdc: number, pricing: MahPricing): MahQuote {
  const { bps, minUsdc, maxUsdc } = pricing.fee
  const feeUsdc = Math.min(amountUsdc, Math.min(maxUsdc, Math.max(minUsdc, amountUsdc * bps / 10000)))
  const netUsdc = amountUsdc - feeUsdc
  return {
    inputUsdc: amountUsdc,
    feeUsdc,
    netUsdc,
    grossMah: amountUsdc * pricing.mahPerUsdc,
    netMah: netUsdc * pricing.mahPerUsdc,
    feeMah: feeUsdc * pricing.mahPerUsdc,
    quotedAt: new Date().toISOString(),
  }
}

// API quote, falling back to the local fee math if the endpoint fails.
export async function quoteMah(amountUsdc: number, pricing: MahPricing): Promise<MahQuote & { fallback: boolean }> {
  try {
    return { ...(await fetchMahQuote(amountUsdc)), fallback: false }
  } catch (e) {
    console.warn('[mah-pricing] quote endpoint failed, using local fee math', e)
    return { ...computeMahQuoteLocally(amountUsdc, pricing), fallback: true }
  }
}

export class MahPricingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MahPricingError'
  }
}

const DECIMAL_RE = /^\d+(\.\d+)?$/

// Backend sends amounts as decimal strings; accept finite non-negative numbers too.
function num(v: unknown, field: string): number {
  const n = typeof v === 'string' && DECIMAL_RE.test(v) ? Number(v)
    : typeof v === 'number' ? v
    : NaN
  if (!Number.isFinite(n) || n < 0) throw new MahPricingError(`Invalid pricing response (${field})`)
  return n
}

function obj(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object') throw new MahPricingError(`Invalid pricing response (${field})`)
  return v as Record<string, unknown>
}

export function parseMahPricing(body: unknown): MahPricing {
  const b = obj(body, 'body')
  if (b.ok !== true) throw new MahPricingError(typeof b.error === 'string' ? b.error : 'Pricing unavailable')
  if (b.asset !== 'MAH' || b.referenceAsset !== 'USDC' || b.direction !== 'USDC_TO_MAH') {
    throw new MahPricingError('Invalid pricing response (asset)')
  }
  const rate = obj(b.rate, 'rate')
  const fee = obj(b.fee, 'fee')
  const mahPerUsdc = num(rate.mahPerUsdc, 'rate.mahPerUsdc')
  if (mahPerUsdc <= 0) throw new MahPricingError('Invalid pricing response (rate.mahPerUsdc)')
  const parsed: MahPricing = {
    mahPerUsdc,
    usdcPerMah: 1 / mahPerUsdc,
    fee: {
      bps: num(fee.bps, 'fee.bps'),
      minUsdc: num(fee.minUsdc, 'fee.minUsdc'),
      maxUsdc: num(fee.maxUsdc, 'fee.maxUsdc'),
    },
    configurationLoadedAt: typeof b.configurationLoadedAt === 'string' ? b.configurationLoadedAt : '',
  }
  if (parsed.fee.maxUsdc < parsed.fee.minUsdc) throw new MahPricingError('Invalid pricing response (fee)')
  return parsed
}

export function parseMahQuote(body: unknown): MahQuote {
  const b = obj(body, 'body')
  if (b.ok !== true) throw new MahPricingError(typeof b.error === 'string' ? b.error : 'Quote unavailable')
  const q: MahQuote = {
    inputUsdc: num(b.inputUsdc, 'inputUsdc'),
    feeUsdc: num(b.feeUsdc, 'feeUsdc'),
    netUsdc: num(b.netUsdc, 'netUsdc'),
    grossMah: num(b.grossMah, 'grossMah'),
    netMah: num(b.netMah, 'netMah'),
    feeMah: num(b.feeMah, 'feeMah'),
    quotedAt: typeof b.quotedAt === 'string' ? b.quotedAt : '',
  }
  if (q.netMah > q.grossMah || q.feeUsdc > q.inputUsdc) throw new MahPricingError('Invalid quote response')
  return q
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let r: Response
  try {
    r = await fetch(url, { signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new MahPricingError('Bridge pricing unreachable')
  }
  const body = await r.json().catch(() => null)
  // 4xx bodies carry { ok:false, error } — surface that message via the parser.
  if (!r.ok && !(body && typeof body === 'object' && 'error' in body)) {
    throw new MahPricingError(`Bridge pricing error (${r.status})`)
  }
  return body
}

export async function fetchMahPricing(signal?: AbortSignal): Promise<MahPricing> {
  return parseMahPricing(await getJson(`${BRIDGE_API}/v1/pricing/mah`, signal))
}

export async function fetchMahQuote(amountUsdc: number, signal?: AbortSignal): Promise<MahQuote> {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) throw new MahPricingError('Invalid USDC amount')
  const amt = amountUsdc.toFixed(6)
  return parseMahQuote(await getJson(`${BRIDGE_API}/v1/pricing/mah/quote?amountUsdc=${encodeURIComponent(amt)}`, signal))
}
