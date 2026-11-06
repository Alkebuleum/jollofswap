// src/lib/polyRpc.ts
//
// Polygon read provider that rotates across several public RPCs.
//
// The free Polygon RPCs (publicnode etc.) rate-limit per IP. With a single
// endpoint, one 429 / "rate limit exceeded" fails the whole swap/bridge flow.
// This provider tries the current endpoint and, on a rate-limit, 5xx or network
// error, moves to the next one (and sticks with it for later calls).
//
// VITE_POLY_RPC may be a single URL or a comma-separated list; it is tried first,
// followed by the built-in fallbacks below.

import { ethers } from 'ethers'

// Five independent providers, each verified 2026-11-06 for chainId 0x89, a live
// block, eth_call on USDC, browser CORS, and 10 parallel requests without a 429.
// Ordered fastest-first; Particle was the slowest (~700ms) so it is last.
// Removed/rejected: llamarpc (DNS gone), maticvigil (shut down), ankr/blockpi/
// rpcfast/nodies (API key now required), onfinality/tatum/zan (rate-limited or
// eth_call blocked without an account).
const DEFAULT_POLY_RPCS = [
  'https://gateway.tenderly.co/public/polygon',
  'https://rpc.sentio.xyz/matic',
  'https://polygon.rpc.thirdweb.com',
  'https://polygon-bor.publicnode.com',
  'https://rpc.particle.network/evm-chain/public?chainId=137',
]

export const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137)

export const POLY_RPCS: string[] = Array.from(new Set([
  ...String(import.meta.env.VITE_POLY_RPC ?? '').split(',').map(s => s.trim()).filter(Boolean),
  ...DEFAULT_POLY_RPCS,
]))

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504])
const RATE_LIMIT_RE = /rate.?limit|too many requests|limit exceeded|exceeded.*(quota|limit)|capacity/i
const RATE_LIMIT_CODES = new Set([-32005, -32090, 429])
const REQUEST_TIMEOUT_MS = 10_000

function isRateLimitedRpcError(item: any): boolean {
  const err = item?.error
  if (!err) return false
  return RATE_LIMIT_CODES.has(Number(err.code)) || RATE_LIMIT_RE.test(String(err.message ?? ''))
}

export class RotatingJsonRpcProvider extends ethers.JsonRpcApiProvider {
  readonly urls: string[]
  #current = 0

  constructor(urls: string[], chainId: number) {
    if (!urls.length) throw new Error('RotatingJsonRpcProvider: no RPC URLs')
    const network = ethers.Network.from(chainId)
    // batchMaxCount 1: free RPCs often count (or reject) batches harshly.
    super(network, { staticNetwork: network, batchMaxCount: 1 })
    this.urls = urls
  }

  async _send(payload: ethers.JsonRpcPayload | ethers.JsonRpcPayload[]): Promise<(ethers.JsonRpcResult | ethers.JsonRpcError)[]> {
    let lastErr: unknown = null
    let lastResult: any[] | null = null

    for (let attempt = 0; attempt < this.urls.length; attempt++) {
      const idx = (this.#current + attempt) % this.urls.length
      const url = this.urls[idx]
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        })
        if (RETRYABLE_HTTP.has(res.status)) {
          lastErr = new Error(`Polygon RPC ${url} returned HTTP ${res.status}`)
          console.warn('[polyRpc] rotating —', (lastErr as Error).message)
          continue
        }
        let body: any = await res.json()
        if (!Array.isArray(body)) body = [body]
        if (body.some(isRateLimitedRpcError)) {
          lastResult = body
          console.warn('[polyRpc] rotating — rate limited by', url, body.find(isRateLimitedRpcError)?.error)
          continue
        }
        this.#current = idx
        return body
      } catch (e) {
        lastErr = e
        console.warn('[polyRpc] rotating — request to', url, 'failed:', (e as any)?.message ?? e)
      } finally {
        clearTimeout(timer)
      }
    }

    if (lastResult) return lastResult
    throw lastErr ?? new Error('All Polygon RPCs failed')
  }
}

export function makePolyProvider(): RotatingJsonRpcProvider {
  return new RotatingJsonRpcProvider(POLY_RPCS, POLY_CHAIN_ID)
}
