import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  applyRpcConfig,
  getPolyRpcs,
  RotatingJsonRpcProvider,
  polygonReceiptStatus,
} from '../polyRpc'

const BUILT_IN = getPolyRpcs()

afterEach(() => {
  applyRpcConfig(undefined) // back to built-in
  vi.unstubAllGlobals()
})

describe('applyRpcConfig (Firestore app_config/rpc)', () => {
  it('uses the Firestore polygon list while active', () => {
    applyRpcConfig({ active: true, polygon: ['https://a.example', 'https://b.example'] })
    expect(getPolyRpcs()).toEqual(['https://a.example', 'https://b.example'])
  })

  it('ignores the list when inactive', () => {
    applyRpcConfig({ active: false, polygon: ['https://a.example'] })
    expect(getPolyRpcs()).toEqual(BUILT_IN)
  })

  it('drops non-https entries and falls back when none are left', () => {
    applyRpcConfig({ active: true, polygon: ['http://insecure.example', 'nonsense', ''] })
    expect(getPolyRpcs()).toEqual(BUILT_IN)
    applyRpcConfig({ active: true, polygon: ['http://insecure.example', 'https://ok.example'] })
    expect(getPolyRpcs()).toEqual(['https://ok.example'])
  })

  it('missing doc → built-in', () => {
    applyRpcConfig({ active: true, polygon: ['https://a.example'] })
    applyRpcConfig(undefined)
    expect(getPolyRpcs()).toEqual(BUILT_IN)
  })
})

function rpcResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('RotatingJsonRpcProvider', () => {
  it('follows a live list and rotates past a rate-limited node', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url)
      const id = JSON.parse(String(init?.body)).id // real nodes echo the request id
      if (url === 'https://limited.example') {
        return rpcResponse({ jsonrpc: '2.0', id, error: { code: -32005, message: 'rate limit exceeded' } })
      }
      return rpcResponse({ jsonrpc: '2.0', id, result: '0x10' })
    }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    applyRpcConfig({ active: true, polygon: ['https://limited.example', 'https://good.example'] })
    const p = new RotatingJsonRpcProvider(getPolyRpcs, 137)
    expect(await p.getBlockNumber()).toBe(16)
    expect(calls).toEqual(['https://limited.example', 'https://good.example'])

    // Firestore switches the list: the same provider uses it on the next call.
    applyRpcConfig({ active: true, polygon: ['https://new.example'] })
    calls.length = 0
    expect(await p.send('eth_gasPrice', [])).toBe('0x10')
    expect(calls).toEqual(['https://new.example'])
  })
})

describe('polygonReceiptStatus', () => {
  it('finds a receipt even when some nodes return null or fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://lagging.example') return rpcResponse({ jsonrpc: '2.0', id: 1, result: null })
      if (url === 'https://down.example') throw new TypeError('network')
      return rpcResponse({ jsonrpc: '2.0', id: 1, result: { blockNumber: '0x1', status: '0x1' } })
    }))
    applyRpcConfig({ active: true, polygon: ['https://lagging.example', 'https://down.example', 'https://ok.example'] })
    expect(await polygonReceiptStatus('0xabc')).toBe(1)
  })

  it('null when no node has it mined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => rpcResponse({ jsonrpc: '2.0', id: 1, result: null })))
    applyRpcConfig({ active: true, polygon: ['https://a.example', 'https://b.example'] })
    expect(await polygonReceiptStatus('0xabc')).toBeNull()
  })
})
