// src/lib/aaOrchestrator.ts
//
// Routes Alkebuleum transactions through the AA wallet (AmID contract).
//
// Primary key  → aaWallet.execute(target, value, data)  — direct, needs ALKE gas
// Linked signer → relay endpoint (gasless executeRelayed via EIP-712 signature)
//
// The relay uses a raw secp256k1 sign of the on-chain EIP-712 digest, computed by
// calling wallet.getRelayedCallHash(). We sign via eth_sign (raw hash) through the
// EIP-1193 provider so the private key never leaves the wallet.

import { ethers } from 'ethers'
import { ALK_CHAIN_ID, ALK_RPC, GAS_PRICE_WEI } from './jollofAmm'

const RELAY_URL = (import.meta.env.VITE_RELAY_URL as string) ?? 'https://relay.alkebuleum.com'

// AmID (AA wallet) ABI — only the functions we call from here
const AMID_IFACE = new ethers.Interface([
  'function primary() view returns (address)',
  'function signerNonce(address signer) view returns (uint256)',
  'function getRelayedCallHash(address signer, address target, uint256 value, bytes calldata data, uint256 nonce, uint256 deadline) view returns (bytes32)',
  'function execute(address target, uint256 value, bytes calldata data)',
])

// Gas overhead added to the inner gas estimate when wrapping through execute()
const EXECUTE_GAS_OVERHEAD = 80_000
// Safety cap for relay-submitted transactions (complex ops like new LP pairs need more gas)
const RELAY_GAS_LIMIT = 8_000_000

export type InnerTx = {
  to: string
  data: string
  value?: string | bigint | number | null
  gas?: number
  gasLimit?: number
}

export type AaResult = {
  ok: boolean
  txHash: string
  error?: string
}

function toHex(v: bigint | number | string): string {
  return '0x' + BigInt(v).toString(16)
}

function toHexValue(v: string | bigint | number | null | undefined): bigint {
  if (v == null || v === '' || v === '0x' || v === '0x0') return 0n
  if (typeof v === 'bigint') return v
  return BigInt(v)
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

function alkProvider() {
  return new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID, { staticNetwork: true })
}

// ── On-chain reads ────────────────────────────────────────────────────────────

export async function getWalletPrimary(aaWallet: string): Promise<string> {
  const provider = alkProvider()
  const result = await provider.call({
    to: aaWallet,
    data: AMID_IFACE.encodeFunctionData('primary', []),
  })
  const [primary] = AMID_IFACE.decodeFunctionResult('primary', result)
  return (primary as string).toLowerCase()
}

async function getSignerNonce(aaWallet: string, signer: string, provider: ethers.JsonRpcProvider): Promise<bigint> {
  const result = await provider.call({
    to: aaWallet,
    data: AMID_IFACE.encodeFunctionData('signerNonce', [signer]),
  })
  const [nonce] = AMID_IFACE.decodeFunctionResult('signerNonce', result)
  return BigInt(nonce)
}

async function getRelayDigest(
  aaWallet: string,
  signer: string,
  target: string,
  value: bigint,
  data: string,
  nonce: bigint,
  deadline: number,
  provider: ethers.JsonRpcProvider,
): Promise<string> {
  const result = await provider.call({
    to: aaWallet,
    data: AMID_IFACE.encodeFunctionData('getRelayedCallHash', [
      signer, target, value, data, nonce, BigInt(deadline),
    ]),
  })
  const [digest] = AMID_IFACE.decodeFunctionResult('getRelayedCallHash', result)
  return digest as string
}

// ── Relay API ─────────────────────────────────────────────────────────────────

type RelayPayload = {
  wallet: string
  signer: string
  target: string
  data: string
  value: string
  deadline: number
  signature: string
  gasLimit?: number
}

async function relayPreview(payload: RelayPayload): Promise<void> {
  const res = await fetch(`${RELAY_URL}/relay/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) {
    throw new Error(`Relay preview failed: ${json?.error ?? json?.rawError ?? res.statusText}`)
  }
}

async function relayExecute(payload: RelayPayload): Promise<string> {
  const res = await fetch(`${RELAY_URL}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) {
    throw new Error(`Relay execute failed: ${json?.error ?? json?.rawError ?? res.statusText}`)
  }
  return json.txHash as string
}

// ── Receipt polling ───────────────────────────────────────────────────────────

async function waitForReceipt(
  txHash: string,
  provider: ethers.JsonRpcProvider,
): Promise<ethers.TransactionReceipt | null> {
  for (let i = 0; i < 80; i++) {
    const receipt = await provider.getTransactionReceipt(txHash).catch(() => null)
    if (receipt) return receipt
    await sleep(1500)
  }
  return null
}

// ── Core orchestrator ─────────────────────────────────────────────────────────

export type AaOrchestratorParams = {
  aaWallet: string
  signerAddress: string  // connected EOA
  eip1193: any           // EIP-1193 provider (WC or window.ethereum)
  innerTxs: InnerTx[]
}

export async function aaExecuteTransactions(params: AaOrchestratorParams): Promise<AaResult[]> {
  const { aaWallet, signerAddress, eip1193, innerTxs } = params
  const provider = alkProvider()

  const primary = await getWalletPrimary(aaWallet)
  const isPrimary = primary === signerAddress.toLowerCase()

  console.log(`[AA] signer=${signerAddress} primary=${primary} isPrimary=${isPrimary}`)

  const results: AaResult[] = []

  for (const inner of innerTxs) {
    const target = inner.to
    const innerData = inner.data ?? '0x'
    const innerValue = toHexValue(inner.value)
    const innerGas = inner.gas ?? inner.gasLimit ?? 600_000

    try {
      if (isPrimary) {
        // ── Primary path: aaWallet.execute(target, value, data) ────────────
        const executeData = AMID_IFACE.encodeFunctionData('execute', [target, innerValue, innerData])
        const outerGas = innerGas + EXECUTE_GAS_OVERHEAD

        const txParams: Record<string, string> = {
          from: signerAddress,
          to: aaWallet,
          data: executeData,
          value: '0x0',  // aaWallet uses its own balance for innerValue forwarding
          gasPrice: toHex(GAS_PRICE_WEI),
          gas: toHex(outerGas),
        }

        console.log('[AA] primary execute →', { target, gas: outerGas })
        const txHash: string = await eip1193.request({ method: 'eth_sendTransaction', params: [txParams] })
        console.log('[AA] primary execute ← hash', txHash)

        const receipt = await waitForReceipt(txHash, provider)
        const ok = receipt?.status === 1
        const result: AaResult = {
          ok,
          txHash,
          error: !receipt ? 'Not confirmed (timeout)' : ok ? undefined : 'Transaction reverted on-chain',
        }
        results.push(result)
        if (!ok) throw new Error(result.error)

      } else {
        // ── Relay path: sign EIP-712 digest, submit via relay ──────────────
        const deadline = Math.floor(Date.now() / 1000) + 10 * 60

        const nonce = await getSignerNonce(aaWallet, signerAddress, provider)
        const digest = await getRelayDigest(
          aaWallet, signerAddress, target, innerValue, innerData, nonce, deadline, provider,
        )

        console.log('[AA] relay sign → digest', digest.substring(0, 14) + '…')

        // eth_sign signs the raw 32-byte digest without any personal_sign prefix.
        // The AmID contract verifies with ecrecover(rawDigest, v, r, s).
        const signature: string = await eip1193.request({
          method: 'eth_sign',
          params: [signerAddress, digest],
        })

        const payload: RelayPayload = {
          wallet: aaWallet,
          signer: signerAddress,
          target,
          data: innerData,
          value: innerValue.toString(),
          deadline,
          signature,
          gasLimit: RELAY_GAS_LIMIT,
        }

        console.log('[AA] relay preview →', { target, nonce: nonce.toString() })
        await relayPreview(payload)

        console.log('[AA] relay execute →')
        const txHash = await relayExecute(payload)
        console.log('[AA] relay execute ← hash', txHash)

        const receipt = await waitForReceipt(txHash, provider)
        const ok = receipt?.status === 1
        const result: AaResult = {
          ok,
          txHash,
          error: !receipt ? 'Not confirmed (timeout)' : ok ? undefined : 'Transaction reverted on-chain',
        }
        results.push(result)
        if (!ok) throw new Error(result.error)
      }
    } catch (err: any) {
      const msg = err?.message ?? 'AA transaction failed'
      results.push({ ok: false, txHash: '', error: msg })
      throw new Error(msg)
    }
  }

  return results
}
