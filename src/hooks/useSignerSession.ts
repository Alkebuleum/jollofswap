// src/hooks/useSignerSession.ts
//
// Session-aware wrappers for sendTransactions and signMessage.
//
// Rules:
//   - If WalletConnect (Nuru) is active → route via wcProvider (ethers BrowserProvider)
//   - Otherwise → use amvault-connect with signer-session metadata
//
// AmVault session rules:
//   - ONE stable sessionId per 10-minute idle window (managed by signerSessionStore)
//   - Before every AmVault call: getOrCreateSignerSession() → build session meta → inject
//   - After every successful AmVault response: touchSignerSession()
//   - Multi-step flows (bridge → swap): startFlow() before step 1, endFlow() in finally

import { useEffect, useCallback } from 'react'
import { BrowserProvider } from 'ethers'
import { sendTransactions as amvSendTransactions, signMessage as amvSignMessage } from 'amvault-connect'
import {
  useSignerSessionStore,
  buildSessionMeta,
  getRemainingMs,
  WARN_MS,
} from '../store/signerSessionStore'
import { useWcStore } from '../store/wcStore'
import { getWcProvider } from '../lib/wcProvider'

const WARN_POLL_MS = 15_000

// ── WC transaction helpers ────────────────────────────────────────────────────

function toHexValue(v: any): bigint {
  if (v == null || v === '' || v === '0x' || v === '0x0') return 0n
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string') {
    return v.startsWith('0x') ? BigInt(v) : BigInt(v)
  }
  return 0n
}

/** Send a list of transactions via WalletConnect or injected window.ethereum. */
async function wcSendTransactions(txPayload: any): Promise<{ ok: boolean; txHash: string; error?: string }[]> {
  const provider = getWcProvider() ?? (window as any).ethereum
  if (!provider) throw new Error('No wallet provider available')

  const ethersProvider = new BrowserProvider(provider as any)
  const signer = await ethersProvider.getSigner()

  const txs: any[] = txPayload.txs ?? []
  const results: { ok: boolean; txHash: string }[] = []

  for (const tx of txs) {
    const sent = await signer.sendTransaction({
      to: tx.to,
      data: tx.data ?? '0x',
      value: toHexValue(tx.value),
      // Include gas limit if specified so Nuru shows accurate fee estimate
      ...(tx.gasLimit != null ? { gasLimit: BigInt(tx.gasLimit) } : {}),
      ...(tx.gas != null && tx.gasLimit == null ? { gasLimit: BigInt(tx.gas) } : {}),
    })

    // Wait for confirmation before sending the next tx (e.g. approve → swap)
    await sent.wait()
    results.push({ ok: true, txHash: sent.hash })
  }

  return results
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSignerSession() {

  // ── 1-minute idle warning poll ────────────────────────────────────────────
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

  // ── Flow helpers ──────────────────────────────────────────────────────────

  const startFlow = useCallback((flowLabel?: string) => {
    return useSignerSessionStore.getState().startFlow(flowLabel)
  }, [])

  const endFlow = useCallback(() => {
    useSignerSessionStore.getState().endFlow()
    console.log('[Jollof] endFlow — flowId cleared')
  }, [])

  // ── Session-aware sendTransactions ────────────────────────────────────────

  const sessionSendTransactions = useCallback(async (
    txPayload: any,
    opts: { app: string; amvaultUrl: string; keepPopupOpen?: boolean },
    flowStep?: string,
  ) => {
    // WalletConnect path — bypass AmVault entirely
    const { wcConnected } = useWcStore.getState()
    if (wcConnected) {
      console.log('[Jollof] sendTransactions via WalletConnect →', { flowStep: flowStep ?? null, txCount: txPayload?.txs?.length ?? 0 })
      const results = await wcSendTransactions(txPayload)
      console.log('[Jollof] sendTransactions via WalletConnect ← ok', results.map(r => r.txHash))
      return results
    }

    // AmVault path
    const s = useSignerSessionStore.getState().getOrCreateSignerSession()
    const sessionMeta = buildSessionMeta(s, flowStep)
    const payload = { ...txPayload, session: sessionMeta }

    console.log('[Jollof] sendTransactions →', {
      flowStep: flowStep ?? null,
      sessionId: s.sessionId,
      flowId: s.flowId ?? null,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
    })

    const results = await amvSendTransactions(payload, opts)

    useSignerSessionStore.getState().touchSignerSession()
    console.log('[Jollof] sendTransactions ← ok | sessionId:', s.sessionId)

    return results
  }, [])

  // ── Session-aware signMessage ─────────────────────────────────────────────

  const sessionSignMessage = useCallback(async (
    msgPayload: any,
    opts: { app: string; amvaultUrl: string },
  ) => {
    const { wcConnected } = useWcStore.getState()
    if (wcConnected) {
      const provider = getWcProvider() ?? (window as any).ethereum
      if (!provider) throw new Error('No wallet provider available')
      const ethersProvider = new BrowserProvider(provider as any)
      const signer = await ethersProvider.getSigner()
      const msg = msgPayload.message ?? msgPayload.msg ?? ''
      return signer.signMessage(msg)
    }

    const s = useSignerSessionStore.getState().getOrCreateSignerSession()
    const sessionMeta = buildSessionMeta(s, 'login')
    const payload = { ...msgPayload, session: sessionMeta }

    console.log('[Jollof] signMessage →', {
      flowStep: 'login',
      sessionId: s.sessionId,
      flowId: s.flowId ?? null,
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
    })

    const result = await amvSignMessage(payload, opts)

    useSignerSessionStore.getState().touchSignerSession()
    console.log('[Jollof] signMessage ← ok | sessionId:', s.sessionId)

    return result
  }, [])

  return { startFlow, endFlow, sessionSendTransactions, sessionSignMessage }
}
