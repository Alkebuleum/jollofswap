// src/lib/polyRpc.ts
//
// Polygon read provider that rotates across several public RPCs.
//
// The free Polygon RPCs (publicnode etc.) rate-limit per IP. With a single
// endpoint, one 429 / "rate limit exceeded" fails the whole swap/bridge flow.
// This provider tries the current endpoint and, on a rate-limit, 5xx or network
// error, moves to the next one (and sticks with it for later calls).
//
// The node list is live: like Nuru, it follows the Firestore doc app_config/rpc
// (field `polygon`, used while `active` is true) — swap a bad node from the
// console and open pages switch within seconds, no deploy. Otherwise the
// built-in list below. VITE_POLY_RPC (one URL or a comma-separated list) is
// always tried first.

import { ethers } from 'ethers'

// Independent providers, each verified 2026-11-06 for chainId 0x89, a live
// block, eth_call on USDC, browser CORS, and 10 parallel requests without a 429.
// Same order as Nuru's live Firestore list (app_config/rpc).
// Removed/rejected: Tenderly (passed read tests but broke the live USDC bridge,
// 2026-11-06), llamarpc (DNS gone), maticvigil (shut down), ankr/blockpi/
// rpcfast/nodies (API key now required), onfinality/tatum/zan (rate-limited or
// eth_call blocked without an account).
const DEFAULT_POLY_RPCS = [
  'https://polygon-bor.publicnode.com',
  'https://rpc.sentio.xyz/matic',
  'https://polygon.rpc.thirdweb.com',
  'https://rpc.particle.network/evm-chain/public?chainId=137',
]

export const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137)

const ENV_POLY_RPCS = String(import.meta.env.VITE_POLY_RPC ?? '').split(',').map(s => s.trim()).filter(Boolean)

let livePolyRpcs: string[] = DEFAULT_POLY_RPCS

/** Current Polygon node list: env override, then Firestore (if active) or built-in. */
export function getPolyRpcs(): string[] {
  return Array.from(new Set([...ENV_POLY_RPCS, ...livePolyRpcs]))
}

/** Same rules as Nuru (rpc_config_service.dart): https only; inactive / missing / empty → built-in. */
export function applyRpcConfig(data: Record<string, unknown> | undefined): void {
  const raw = data?.active === true ? data.polygon : undefined
  const urls = Array.isArray(raw)
    ? raw.map(u => String(u).trim()).filter(u => { try { return new URL(u).protocol === 'https:' } catch { return false } })
    : []
  const next = urls.length ? urls : DEFAULT_POLY_RPCS
  if (next.join() !== livePolyRpcs.join()) {
    livePolyRpcs = next
    console.info('[polyRpc] Polygon RPCs', urls.length ? '(Firestore app_config/rpc)' : '(built-in)', next)
  }
}

let remoteStarted = false
/** Follow app_config/rpc live (once per page). Never blocks; failures keep the current list. */
function startRemoteRpcConfig(): void {
  if (remoteStarted || typeof window === 'undefined') return
  remoteStarted = true
  void (async () => {
    try {
      const [{ db }, { doc, onSnapshot }] = await Promise.all([import('../services/firebase'), import('firebase/firestore')])
      onSnapshot(
        doc(db, 'app_config', 'rpc'),
        snap => applyRpcConfig(snap.data()),
        err => console.warn('[polyRpc] app_config/rpc unavailable, keeping current list', err),
      )
    } catch (e) {
      console.warn('[polyRpc] remote RPC config not started', e)
    }
  })()
}

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
  #getUrls: () => string[]
  #current = 0

  /** [urls]: a fixed list, or a function read on every request (live list). */
  constructor(urls: string[] | (() => string[]), chainId: number) {
    const network = ethers.Network.from(chainId)
    // batchMaxCount 1: free RPCs often count (or reject) batches harshly.
    super(network, { staticNetwork: network, batchMaxCount: 1 })
    this.#getUrls = typeof urls === 'function' ? urls : () => urls
  }

  get urls(): string[] {
    return this.#getUrls()
  }

  async _send(payload: ethers.JsonRpcPayload | ethers.JsonRpcPayload[]): Promise<(ethers.JsonRpcResult | ethers.JsonRpcError)[]> {
    let lastErr: unknown = null
    let lastResult: any[] | null = null

    const urls = this.urls
    if (!urls.length) throw new Error('No Polygon RPC URLs')
    for (let attempt = 0; attempt < urls.length; attempt++) {
      const idx = (this.#current + attempt) % urls.length
      const url = urls[idx]
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

async function rpcAll(method: string, params: unknown[]): Promise<any[]> {
  const settled = await Promise.allSettled(getPolyRpcs().map(async (url) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      })
      const body = await res.json()
      return body?.result ?? null
    } finally {
      clearTimeout(timer)
    }
  }))
  return settled.map(s => (s.status === 'fulfilled' ? s.value : null))
}

/**
 * Receipt status of a Polygon tx, asking EVERY node at once: 1 = success,
 * 0 = reverted, null = no node has it mined yet. One node lagging, rate-limiting
 * or returning null no longer makes a mined tx look unconfirmed.
 */
export async function polygonReceiptStatus(txHash: string): Promise<number | null> {
  for (const r of await rpcAll('eth_getTransactionReceipt', [txHash])) {
    if (r && r.blockNumber) return parseInt(String(r.status ?? '0x0'), 16)
  }
  return null
}

/** Does any Polygon node know this tx at all (pending or mined)? */
export async function polygonTxKnown(txHash: string): Promise<boolean> {
  return (await rpcAll('eth_getTransactionByHash', [txHash])).some(Boolean)
}

export function makePolyProvider(): RotatingJsonRpcProvider {
  startRemoteRpcConfig()
  return new RotatingJsonRpcProvider(getPolyRpcs, POLY_CHAIN_ID)
}
