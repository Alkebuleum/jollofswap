// src/hooks/useSignerSession.ts
//
// Session-aware wrappers for sendTransactions and signMessage.
//
// Routing:
//   - WalletConnect or injected window.ethereum (Nuru browser) → standard EIP-1193
//   - Otherwise → amvault-connect (legacy AmVault users)
//
// WC/injected path uses direct eth_sendTransaction calls (not ethers BrowserProvider)
// so Alkebuleum's required legacy type-0 transactions are sent correctly.
// Receipt confirmation polls the public JSON-RPC directly rather than the wallet provider.

import { useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { sendTransactions as amvSendTransactions, signMessage as amvSignMessage } from 'amvault-connect'
import {
  useSignerSessionStore,
  buildSessionMeta,
  getRemainingMs,
  WARN_MS,
} from '../store/signerSessionStore'
import { useWcStore } from '../store/wcStore'
import { getWcProvider } from '../lib/wcProvider'
import { ALK_CHAIN_ID, ALK_RPC, GAS_PRICE_WEI } from '../lib/jollofAmm'

const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137)
const POLY_RPC = (import.meta.env.VITE_POLY_RPC as string) ?? 'https://polygon-bor-rpc.publicnode.com'

const WARN_POLL_MS = 15_000
const RECEIPT_POLL_MS = 1_500
const RECEIPT_MAX_POLLS = 80

// ── helpers ──────────────────────────────────────────────────────────────────

function toHexValue(v: any): bigint {
  if (v == null || v === '' || v === '0x' || v === '0x0') return 0n
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string') return v.startsWith('0x') ? BigInt(v) : BigInt(v)
  return 0n
}

function toHex(v: bigint | number | string): string {
  return '0x' + BigInt(v).toString(16)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── EIP-1193 transaction sender ───────────────────────────────────────────────
//
// Sends transactions via the connected wallet's EIP-1193 provider with explicit
// legacy (type-0) gas fields so Alkebuleum's Besu node accepts them.
// Polls receipts via the public JSON-RPC to avoid quirks in wallet providers.

async function wcSendTransactions(txPayload: any): Promise<{ ok: boolean; txHash: string; error?: string }[]> {
  const eip1193 = getWcProvider() ?? (window as any).ethereum
  if (!eip1193) throw new Error('No wallet connected. Please connect your wallet first.')

  // Determine which chain the transactions are for
  const reqChainId: number | undefined =
    typeof txPayload.chainId === 'number' ? txPayload.chainId : undefined

  // Validate the wallet is on the right chain — reject Polygon txs for Nuru/WC wallets
  if (reqChainId && reqChainId !== ALK_CHAIN_ID) {
    const rawChain = await eip1193.request({ method: 'eth_chainId' })
    const currentChainId = typeof rawChain === 'number'
      ? rawChain
      : parseInt(String(rawChain).replace('0x', ''), 16)
    if (currentChainId !== reqChainId) {
      const chainName = reqChainId === POLY_CHAIN_ID ? 'Polygon' : `chain ${reqChainId}`
      // Try a chain switch first (works if the wallet supports it)
      try {
        await eip1193.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: toHex(reqChainId) }],
        })
      } catch {
        throw new Error(
          reqChainId === POLY_CHAIN_ID
            ? `Bridging USDC requires a Polygon wallet (e.g. MetaMask). Your Nuru wallet only supports Alkebuleum. Open JollofSwap in a browser with MetaMask to bridge USDC, or ensure you already have MAH on Alkebuleum to swap directly.`
            : `This transaction requires ${chainName} but your wallet is on chain ${currentChainId}.`
        )
      }
    }
  }

  // Poll receipts via public RPC — not the wallet provider (more reliable for all wallet types)
  const isPolygon = reqChainId === POLY_CHAIN_ID
  const rpcUrl = isPolygon ? POLY_RPC : ALK_RPC
  const rpcChainId = isPolygon ? POLY_CHAIN_ID : ALK_CHAIN_ID
  const rpcProvider = new ethers.JsonRpcProvider(rpcUrl, rpcChainId, { staticNetwork: true })

  // Get the sender address
  const accounts: string[] = await eip1193.request({ method: 'eth_accounts' })
  const from = accounts?.[0]
  if (!from) throw new Error('No account available — connect your wallet first.')

  const txList: any[] = txPayload.txs ?? []
  const results: { ok: boolean; txHash: string; error?: string }[] = []

  for (const tx of txList) {
    // Build legacy (type-0) tx params — explicit gasPrice, no EIP-1559 fields.
    // Alkebuleum's Besu node requires type-0 transactions.
    const gasLimit = tx.gas ?? tx.gasLimit
    const gasPrice = tx.gasPrice != null
      ? (typeof tx.gasPrice === 'string' && tx.gasPrice.startsWith('0x') ? tx.gasPrice : toHex(tx.gasPrice))
      : toHex(GAS_PRICE_WEI)   // 5 gwei default

    const txParams: Record<string, string> = {
      from,
      to: tx.to,
      data: tx.data ?? '0x',
      value: toHex(toHexValue(tx.value)),
      gasPrice,
    }
    if (gasLimit != null) txParams.gas = toHex(BigInt(gasLimit))

    console.log('[Jollof] eth_sendTransaction →', { to: tx.to, gas: txParams.gas, chainId: reqChainId })

    const txHash: string = await eip1193.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    })

    console.log('[Jollof] eth_sendTransaction ← hash', txHash)

    // Poll for receipt via public RPC
    let receipt: ethers.TransactionReceipt | null = null
    for (let i = 0; i < RECEIPT_MAX_POLLS; i++) {
      receipt = await rpcProvider.getTransactionReceipt(txHash).catch(() => null)
      if (receipt) break
      await sleep(RECEIPT_POLL_MS)
    }

    const ok = receipt?.status === 1
    const error = !receipt
      ? 'Transaction not confirmed — check your wallet for status.'
      : receipt.status === 0
        ? 'Transaction reverted on-chain.'
        : undefined
    results.push({ ok, txHash, error })

    if (!ok && txPayload.failFast) {
      throw new Error(error ?? 'Transaction failed')
    }
  }

  return results
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSignerSession() {

  // 1-minute idle warning poll (AmVault users only — WC users have no idle session)
  useEffect(() => {
    const id = setInterval(() => {
      const store = useSignerSessionStore.getState()
      if (!store.isSignerSessionExpired()) {
        const s = store.session!
        if (getRemainingMs(s) <= WARN_MS) {
          store.setShowWarning(true)
        }
      }
    }, WARN_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const startFlow = useCallback((flowLabel?: string) => {
    return useSignerSessionStore.getState().startFlow(flowLabel)
  }, [])

  const endFlow = useCallback(() => {
    useSignerSessionStore.getState().endFlow()
    console.log('[Jollof] endFlow — flowId cleared')
  }, [])

  // ── sendTransactions ────────────────────────────────────────────────────────

  const sessionSendTransactions = useCallback(async (
    txPayload: any,
    opts: { app: string; amvaultUrl: string; keepPopupOpen?: boolean },
    flowStep?: string,
  ) => {
    // WalletConnect / injected wallet path
    const { wcConnected } = useWcStore.getState()
    if (wcConnected) {
      console.log('[Jollof] sendTransactions via wallet →', {
        flowStep: flowStep ?? null,
        txCount: txPayload?.txs?.length ?? 0,
        chainId: txPayload?.chainId,
      })
      const results = await wcSendTransactions(txPayload)
      console.log('[Jollof] sendTransactions via wallet ← ok', results.map(r => r.txHash))
      return results
    }

    // AmVault path (legacy)
    const s = useSignerSessionStore.getState().getOrCreateSignerSession()
    const sessionMeta = buildSessionMeta(s, flowStep)
    const payload = { ...txPayload, session: sessionMeta }

    console.log('[Jollof] sendTransactions via AmVault →', {
      flowStep: flowStep ?? null,
      sessionId: s.sessionId,
      flowId: s.flowId ?? null,
    })

    const results = await amvSendTransactions(payload, opts)
    useSignerSessionStore.getState().touchSignerSession()
    console.log('[Jollof] sendTransactions via AmVault ← ok | sessionId:', s.sessionId)
    return results
  }, [])

  // ── signMessage ─────────────────────────────────────────────────────────────

  const sessionSignMessage = useCallback(async (
    msgPayload: any,
    opts: { app: string; amvaultUrl: string },
  ) => {
    const { wcConnected } = useWcStore.getState()
    if (wcConnected) {
      const eip1193 = getWcProvider() ?? (window as any).ethereum
      if (!eip1193) throw new Error('No wallet connected')
      const accounts: string[] = await eip1193.request({ method: 'eth_accounts' })
      const from = accounts?.[0]
      if (!from) throw new Error('No account available')
      const msg: string = msgPayload.message ?? msgPayload.msg ?? ''
      // Encode as UTF-8 hex for personal_sign (wallet adds EIP-191 prefix internally)
      const msgHex = ethers.hexlify(ethers.toUtf8Bytes(msg))
      const sig = await eip1193.request({ method: 'personal_sign', params: [msgHex, from] })
      return sig
    }

    // AmVault path (legacy)
    const s = useSignerSessionStore.getState().getOrCreateSignerSession()
    const sessionMeta = buildSessionMeta(s, 'login')
    const payload = { ...msgPayload, session: sessionMeta }

    console.log('[Jollof] signMessage via AmVault →', { sessionId: s.sessionId })
    const result = await amvSignMessage(payload, opts)
    useSignerSessionStore.getState().touchSignerSession()
    console.log('[Jollof] signMessage via AmVault ← ok')
    return result
  }, [])

  return { startFlow, endFlow, sessionSendTransactions, sessionSignMessage }
}
