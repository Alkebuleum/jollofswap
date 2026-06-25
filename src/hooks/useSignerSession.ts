// src/hooks/useSignerSession.ts
//
// Session-aware wrappers for sendTransactions and signMessage.
//
// Routing:
//   - WalletConnect or injected window.ethereum (Nuru browser) → Nuru QR signing
//   - Otherwise → amvault-connect (legacy AmVault users)
//
// For WC/injected wallet: all signing ops go through nuruSign (QR + Firestore).
// The full transaction data is embedded in the QR so Nuru approves locally —
// no WalletConnect relay required for the signing step.
// Receipt confirmation polls the public JSON-RPC directly.

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
import { useWcSigningStore } from '../store/wcSigningStore'
import { createNuruProvider, nuruSign } from '../lib/nuruSigning'

const POLY_CHAIN_ID = Number(import.meta.env.VITE_POLY_CHAIN_ID ?? 137)
const POLY_RPC = (import.meta.env.VITE_POLY_RPC as string) ?? 'https://polygon-bor-rpc.publicnode.com'
const FAUCET_API = (import.meta.env.VITE_FAUCET_API as string) ?? 'https://faucet.alkebuleum.com/api'

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

async function runPolyTopupIfNeeded(
  nuruProvider: any,
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

  // Signed by Nuru via QR — the nuruProvider wrapper handles the QR/Firestore flow
  const signature: string = await nuruProvider.request({
    method: 'personal_sign',
    params: [msgHex, address],
  })

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

// ── Nuru in-app browser path ──────────────────────────────────────────────────
//
// JollofSwap is running inside the Nuru dApp browser (window.ethereum._isNuruWallet).
// All signing goes through window.ethereum directly — the browser shows a native
// Dart approval sheet for each tx/signature without any QR or Firestore involved.
//
// IMPORTANT: Do NOT wrap txs through aaExecuteTransactions here. The Nuru dApp
// browser already wraps Alkebuleum txs through the AA wallet's execute() internally
// (dapp_browser_tab.dart line 498). Double-wrapping would cause execute(execute(...)).

async function nuroBrowserSendTransactions(txPayload: any, skipAaWrap = false): Promise<{ ok: boolean; txHash: string; error?: string }[]> {
  const injEth = (window as any).ethereum
  const txList: any[] = txPayload.txs ?? []

  const reqChainId: number | undefined =
    typeof txPayload.chainId === 'number' ? txPayload.chainId : undefined
  const isPolygon   = reqChainId === POLY_CHAIN_ID
  const rpcUrl      = isPolygon ? POLY_RPC : ALK_RPC
  const rpcChainId  = isPolygon ? POLY_CHAIN_ID : ALK_CHAIN_ID
  const rpcProvider = new ethers.JsonRpcProvider(rpcUrl, rpcChainId, { staticNetwork: true })

  // When skipAaWrap is set, include from: signerAddress so the tx is sent directly
  // from the signer EOA rather than being wrapped by Nuru in aaWallet.execute().
  const directSigner = skipAaWrap ? (useWcStore.getState().signer ?? null) : null

  // Switch chain in the WebView if needed before sending
  if (reqChainId != null) {
    const curHex: string = await injEth.request({ method: 'eth_chainId' }).catch(() => null)
    const curChain = curHex ? parseInt(curHex, 16) : null
    if (curChain !== reqChainId) {
      await injEth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x' + reqChainId.toString(16) }],
      })
    }
  }

  // For Polygon txs, ensure the EOA has enough POL for gas (faucet top-up if needed).
  // window.ethereum serves as the nuruProvider here — personal_sign shows a native approval sheet.
  if (isPolygon) {
    const signerAddress = useWcStore.getState().signer
    if (signerAddress) {
      await runPolyTopupIfNeeded(injEth, signerAddress, rpcProvider)
    }
  }

  // Phase 1: send each tx through the injected provider (native approval sheet per tx)
  const txHashes: string[] = []
  for (const tx of txList) {
    const txParams: Record<string, string> = {
      to:    tx.to,
      data:  tx.data ?? '0x',
      value: toHex(toHexValue(tx.value)),
    }
    if (directSigner) txParams.from = directSigner
    const gasLimit = tx.gas ?? tx.gasLimit
    if (gasLimit != null) txParams.gas = toHex(BigInt(gasLimit))
    if (tx.gasPrice != null) {
      txParams.gasPrice = typeof tx.gasPrice === 'string' && tx.gasPrice.startsWith('0x')
        ? tx.gasPrice
        : toHex(BigInt(tx.gasPrice))
    }
    const txHash: string = await injEth.request({ method: 'eth_sendTransaction', params: [txParams] })
    txHashes.push(txHash)
  }

  // Phase 2: poll receipts
  const results: { ok: boolean; txHash: string; error?: string }[] = []
  for (const txHash of txHashes) {
    let receipt: ethers.TransactionReceipt | null = null
    for (let p = 0; p < RECEIPT_MAX_POLLS; p++) {
      receipt = await rpcProvider.getTransactionReceipt(txHash).catch(() => null)
      if (receipt) break
      await sleep(RECEIPT_POLL_MS)
    }
    const ok = receipt?.status === 1
    const error = !receipt
      ? 'Transaction not confirmed — check your wallet for status.'
      : receipt.status === 0 ? 'Transaction reverted on-chain.' : undefined
    results.push({ ok, txHash, error })
    if (!ok && txPayload.failFast) throw new Error(error ?? 'Transaction failed')
  }

  return results
}

// ── EIP-1193 transaction sender (Nuru QR path) ───────────────────────────────
//
// All signing goes through a nuruProvider wrapper — transactions and messages
// are QR-scanned and approved in Nuru without any WalletConnect relay.

async function wcSendTransactions(txPayload: any, label = 'Transaction', skipAaWrap = false): Promise<{ ok: boolean; txHash: string; error?: string }[]> {
  // Get connected addresses from store — Firebase connect provides both aaWallet and signer
  const { wcAddress: connectedAddr, signer: signerAddr } = useWcStore.getState()
  if (!connectedAddr) throw new Error('No wallet connected. Please connect your wallet first.')

  const signingStore = useWcSigningStore.getState()

  const reqChainId: number | undefined =
    typeof txPayload.chainId === 'number' ? txPayload.chainId : undefined

  const isPolygon    = reqChainId === POLY_CHAIN_ID
  const isAlkebuleum = reqChainId === ALK_CHAIN_ID
  const rpcUrl       = isPolygon ? POLY_RPC : ALK_RPC
  const rpcChainId   = isPolygon ? POLY_CHAIN_ID : ALK_CHAIN_ID
  const rpcProvider  = new ethers.JsonRpcProvider(rpcUrl, rpcChainId, { staticNetwork: true })

  // The EOA that actually signs. Falls back to connectedAddr (aaWallet) for injected wallet case.
  const effectiveSigner = signerAddr ?? connectedAddr

  // Extract txList before creating nuruProvider so total is captured in the onBegin closure
  const txList: any[] = txPayload.txs ?? []
  const { aaWallet } = useWalletMetaStore.getState()
  const totalSigningSteps = Math.max(txList.length, 1)

  // Stub EIP-1193: read-only calls go to RPC; signing calls are intercepted by nuruProvider.
  // eth_accounts returns the AA wallet so dApps see the correct display address + balance.
  const wcProvider = getWcProvider()
  const injectedEth = typeof window !== 'undefined' ? (window as any).ethereum : null
  const stubEip1193 = {
    request: async ({ method, params }: { method: string; params?: any[] }): Promise<any> => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [connectedAddr]
      if (method === 'eth_chainId') return toHex(rpcChainId)
      if (method === 'wallet_switchEthereumChain') return null  // routing is txPayload.chainId-based
      const real = wcProvider ?? injectedEth
      if (real) return real.request({ method, params })
      return rpcProvider.send(method, params ?? [])
    },
  }

  // Create the Nuru provider wrapper — all signing ops routed through QR + Firestore
  const nuruProvider = createNuruProvider(
    stubEip1193,
    reqChainId,
    label,
    (qrPayload) => signingStore.begin(qrPayload, label, totalSigningSteps),
    (qrPayload) => signingStore.next(qrPayload),
  )

  try {
    if (isPolygon) {
      // Top up the EOA signer's POL balance (signer pays gas on Polygon)
      await runPolyTopupIfNeeded(nuruProvider, effectiveSigner, rpcProvider)
    }

    // ── AA wallet path (Alkebuleum only) ─────────────────────────────────────
    if (isAlkebuleum && aaWallet && !skipAaWrap) {
      console.log('[Jollof] AA path → aaWallet', aaWallet, 'signer', effectiveSigner)
      // await so that finally runs after aaExecuteTransactions fully completes,
      // not synchronously right after the return statement
      return await aaExecuteTransactions({
        aaWallet,
        signerAddress: effectiveSigner,
        eip1193: nuruProvider,
        innerTxs: txList,
      })
    }

    // ── Direct EOA path ───────────────────────────────────────────────────────
    let cachedGasPrice: bigint | null = null
    async function getChainGasPrice(): Promise<bigint> {
      if (cachedGasPrice == null) {
        const feeData = await rpcProvider.getFeeData().catch(() => null)
        cachedGasPrice = feeData?.gasPrice ?? (isPolygon ? 30_000_000_000n : GAS_PRICE_WEI)
      }
      return cachedGasPrice!
    }

    // ── Phase 1: sign all transactions (QR is visible here) ──────────────────
    const txHashes: string[] = []
    for (let _txIdx = 0; _txIdx < txList.length; _txIdx++) {
      const tx = txList[_txIdx]
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
        from: effectiveSigner,
        to: tx.to,
        data: tx.data ?? '0x',
        value: toHex(toHexValue(tx.value)),
        gasPrice: gasPriceHex,
      }
      if (gasLimit != null) txParams.gas = toHex(BigInt(gasLimit))

      console.log('[Jollof] eth_sendTransaction →', { to: tx.to, gas: txParams.gas, gasPrice: txParams.gasPrice, chainId: reqChainId })

      const txHash: string = await nuruProvider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      })

      console.log('[Jollof] eth_sendTransaction ← hash', txHash)
      txHashes.push(txHash)
    }

    // Close the QR modal as soon as all signing is done — tx is in the mempool.
    // Receipt polling happens below without the QR on screen.
    signingStore.done()

    // ── Phase 2: poll for receipts (QR is hidden) ────────────────────────────
    const results: { ok: boolean; txHash: string; error?: string }[] = []
    for (let i = 0; i < txHashes.length; i++) {
      const txHash = txHashes[i]
      let receipt: ethers.TransactionReceipt | null = null
      for (let p = 0; p < RECEIPT_MAX_POLLS; p++) {
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

  } finally {
    // Safety net: ensure modal closes even if an error is thrown during signing
    signingStore.done()
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSignerSession() {

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
    opts: { app: string; amvaultUrl: string; keepPopupOpen?: boolean; skipAaWrap?: boolean },
    flowStep?: string,
  ) => {
    const { wcConnected } = useWcStore.getState()
    const injectedEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    const isNuroBrowser = injectedEth?._isNuruWallet === true

    if (wcConnected && isNuroBrowser) {
      // Inside Nuru dApp browser — use window.ethereum directly (native approval sheets).
      // When skipAaWrap is true, include from: signerAddress so Nuru sends from the EOA
      // directly instead of wrapping in aaWallet.execute() (used for signer → aaWallet deposits).
      console.log('[Jollof] sendTransactions via Nuru browser →', {
        txCount: txPayload?.txs?.length ?? 0,
        chainId: txPayload?.chainId,
        skipAaWrap: opts.skipAaWrap ?? false,
      })
      const results = await nuroBrowserSendTransactions(txPayload, opts.skipAaWrap ?? false)
      console.log('[Jollof] sendTransactions via Nuru browser ← ok', results.map(r => r.txHash))
      return results
    }

    if (wcConnected) {
      console.log('[Jollof] sendTransactions via Nuru QR →', {
        flowStep: flowStep ?? null,
        txCount: txPayload?.txs?.length ?? 0,
        chainId: txPayload?.chainId,
        skipAaWrap: opts.skipAaWrap ?? false,
      })
      const label = flowStep ?? txPayload?.label ?? opts.app ?? 'Transaction'
      const results = await wcSendTransactions(txPayload, label, opts.skipAaWrap ?? false)
      console.log('[Jollof] sendTransactions via Nuru QR ← ok', results.map(r => r.txHash))
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
    const { wcConnected, wcAddress } = useWcStore.getState()
    const injectedEth = typeof window !== 'undefined' ? (window as any).ethereum : null
    const isNuroBrowser = injectedEth?._isNuruWallet === true

    if (wcConnected && isNuroBrowser) {
      // Inside Nuru dApp browser — personal_sign goes through injected provider (native sheet).
      if (!wcAddress) throw new Error('No account available')
      const msg: string = msgPayload.message ?? msgPayload.msg ?? ''
      const msgHex = ethers.hexlify(ethers.toUtf8Bytes(msg))
      return await injectedEth.request({ method: 'personal_sign', params: [msgHex, wcAddress] })
    }

    if (wcConnected) {
      if (!wcAddress) throw new Error('No account available')
      const msg: string = msgPayload.message ?? msgPayload.msg ?? ''
      const msgHex = ethers.hexlify(ethers.toUtf8Bytes(msg))
      const signingStore = useWcSigningStore.getState()
      try {
        const sig = await nuruSign(
          'personal_sign',
          [msgHex, wcAddress],
          ALK_CHAIN_ID,
          (_, qrPayload) => signingStore.begin(qrPayload, 'Signature'),
        )
        return sig
      } finally {
        signingStore.done()
      }
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
