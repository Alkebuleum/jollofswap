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
import { aaExecuteTransactions } from '../lib/aaOrchestrator'
import { useWalletMetaStore } from '../store/walletMetaStore'

const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137)
const POLY_RPC = (import.meta.env.VITE_POLY_RPC as string) ?? 'https://polygon-bor-rpc.publicnode.com'
const FAUCET_API = (import.meta.env.VITE_FAUCET_API as string) ?? 'https://faucet.alkebuleum.com/api'

// Minimum POL balance required before Polygon bridge transactions
const MIN_POL_WEI = ethers.parseEther('0.1')

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

// ── Polygon POL gas top-up ────────────────────────────────────────────────────
//
// Mirrors the Nuru native faucet flow: if the wallet has < 0.1 POL, request a
// signed challenge from the faucet, sign it with personal_sign, and submit.
// This is called automatically before any Polygon bridge transaction.

async function runPolyTopupIfNeeded(
  eip1193: any,
  address: string,
  rpcProvider: ethers.JsonRpcProvider,
): Promise<void> {
  const balance = await rpcProvider.getBalance(address).catch(() => 0n)
  if (BigInt(balance) >= MIN_POL_WEI) return

  console.log('[Jollof] POL balance low — requesting faucet topup')

  const challengeRes = await fetch(
    `${FAUCET_API}/poly/topup/challenge?address=${encodeURIComponent(address)}&purpose=jswap-bridge`
  )
  const challenge = await challengeRes.json().catch(() => null)
  if (!challenge?.nonce || !challenge?.deadline) {
    throw new Error('Could not get POL gas top-up challenge. Please add POL to your wallet on Polygon.')
  }

  const msg: string = challenge.message ?? [
    'Alkebuleum Faucet POL Topup',
    `address:${address}`,
    `nonce:${challenge.nonce}`,
    `deadline:${challenge.deadline}`,
    'purpose:jswap-bridge',
  ].join('\n')

  const msgHex = ethers.hexlify(ethers.toUtf8Bytes(msg))
  const signature: string = await eip1193.request({ method: 'personal_sign', params: [msgHex, address] })

  const submitRes = await fetch(`${FAUCET_API}/poly/topup/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce: challenge.nonce, deadline: challenge.deadline, signature, purpose: 'jswap-bridge' }),
  })
  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => null)
    if (submitRes.status === 429) {
      throw new Error(`POL gas top-up rate limit reached. ${err?.message ?? 'Please add POL to your wallet on Polygon and retry.'}`)
    }
    throw new Error(err?.error ?? 'POL gas top-up failed. Please add POL to your wallet on Polygon.')
  }

  // Wait for balance to reflect (up to 10 seconds)
  for (let i = 0; i < 10; i++) {
    await sleep(1000)
    const newBal = await rpcProvider.getBalance(address).catch(() => 0n)
    if (BigInt(newBal) >= MIN_POL_WEI) {
      console.log('[Jollof] POL topup confirmed')
      return
    }
  }
  throw new Error('POL top-up submitted but balance not updated yet. Please retry in a moment.')
}

// ── EIP-1193 transaction sender ───────────────────────────────────────────────
//
// Sends transactions via the connected wallet's EIP-1193 provider with explicit
// legacy (type-0) gas fields so Alkebuleum's Besu node accepts them.
// Polls receipts via the public JSON-RPC to avoid quirks in wallet providers.

async function wcSendTransactions(txPayload: any): Promise<{ ok: boolean; txHash: string; error?: string }[]> {
  const eip1193 = getWcProvider() ?? (window as any).ethereum
  if (!eip1193) throw new Error('No wallet connected. Please connect your wallet first.')

  const reqChainId: number | undefined =
    typeof txPayload.chainId === 'number' ? txPayload.chainId : undefined

  // Switch to the required chain if needed (Alkebuleum or Polygon both supported)
  if (reqChainId) {
    const rawChain = await eip1193.request({ method: 'eth_chainId' })
    const currentChainId = typeof rawChain === 'number'
      ? rawChain
      : parseInt(String(rawChain).replace('0x', ''), 16)
    if (currentChainId !== reqChainId) {
      await eip1193.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHex(reqChainId) }],
      })
      await sleep(300) // let chain switch settle in the wallet
    }
  }

  const isPolygon = reqChainId === POLY_CHAIN_ID
  const isAlkebuleum = reqChainId === ALK_CHAIN_ID
  const rpcUrl = isPolygon ? POLY_RPC : ALK_RPC
  const rpcChainId = isPolygon ? POLY_CHAIN_ID : ALK_CHAIN_ID
  // Poll receipts via public RPC — more reliable than using the wallet provider
  const rpcProvider = new ethers.JsonRpcProvider(rpcUrl, rpcChainId, { staticNetwork: true })

  const accounts: string[] = await eip1193.request({ method: 'eth_accounts' })
  const from = accounts?.[0]
  if (!from) throw new Error('No account available — connect your wallet first.')

  // Ensure the wallet has enough POL for Polygon gas before submitting bridge txs
  if (isPolygon) {
    await runPolyTopupIfNeeded(eip1193, from, rpcProvider)
  }

  const txList: any[] = txPayload.txs ?? []

  // ── AA wallet path (Alkebuleum only) ─────────────────────────────────────
  // When the user has an AA wallet registered, all Alkebuleum transactions are
  // routed through aaWallet.execute() (primary key) or the relay (linked signer).
  // Polygon bridge transactions always go direct-EOA regardless.
  const { aaWallet } = useWalletMetaStore.getState()
  if (isAlkebuleum && aaWallet) {
    console.log('[Jollof] AA path → aaWallet', aaWallet, 'signer', from)
    const aaResults = await aaExecuteTransactions({
      aaWallet,
      signerAddress: from,
      eip1193,
      innerTxs: txList,
    })
    return aaResults
  }

  // ── Direct EOA path (Polygon bridge + fallback when no AA wallet) ─────────
  let cachedGasPrice: bigint | null = null
  async function getChainGasPrice(): Promise<bigint> {
    if (cachedGasPrice == null) {
      const feeData = await rpcProvider.getFeeData().catch(() => null)
      cachedGasPrice = feeData?.gasPrice ?? (isPolygon ? 30_000_000_000n : GAS_PRICE_WEI)
    }
    return cachedGasPrice!
  }

  const results: { ok: boolean; txHash: string; error?: string }[] = []

  for (const tx of txList) {
    const gasLimit = tx.gas ?? tx.gasLimit

    let gasPriceHex: string
    if (tx.gasPrice != null) {
      gasPriceHex = typeof tx.gasPrice === 'string' && tx.gasPrice.startsWith('0x')
        ? tx.gasPrice
        : toHex(tx.gasPrice)
    } else {
      gasPriceHex = toHex(await getChainGasPrice())
    }

    const txParams: Record<string, string> = {
      from,
      to: tx.to,
      data: tx.data ?? '0x',
      value: toHex(toHexValue(tx.value)),
      gasPrice: gasPriceHex,
    }
    if (gasLimit != null) txParams.gas = toHex(BigInt(gasLimit))

    console.log('[Jollof] eth_sendTransaction →', { to: tx.to, gas: txParams.gas, gasPrice: txParams.gasPrice, chainId: reqChainId })

    const txHash: string = await eip1193.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    })

    console.log('[Jollof] eth_sendTransaction ← hash', txHash)

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

  // Switch back to Alkebuleum after Polygon transactions so the wallet is ready for next action
  if (isPolygon) {
    await eip1193.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHex(ALK_CHAIN_ID) }],
    }).catch(() => {}) // non-fatal
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
