// src/hooks/useSignerSession.ts
//
// Session-aware wrappers for amvault-connect's sendTransactions and signMessage.
//
// Rules:
//   - ONE stable sessionId per 10-minute idle window (managed by signerSessionStore)
//   - Before every AmVault call: getOrCreateSignerSession() → build session meta → inject
//   - After every successful AmVault response: touchSignerSession()
//   - Multi-step flows (bridge → swap): startFlow() before step 1, endFlow() in finally

import { useEffect, useCallback } from 'react'
import { sendTransactions as amvSendTransactions, signMessage as amvSignMessage } from 'amvault-connect'
import {
  useSignerSessionStore,
  buildSessionMeta,
  getRemainingMs,
  WARN_MS,
} from '../store/signerSessionStore'

const WARN_POLL_MS = 15_000

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

  /** Start a multi-step flow — creates a new flowId, extends window if needed.
   *  Always reuses the current sessionId. */
  const startFlow = useCallback((flowLabel?: string) => {
    // Logging happens inside store.startFlow
    return useSignerSessionStore.getState().startFlow(flowLabel)
  }, [])

  /** End the current multi-step flow — clears flowId, keeps session alive. */
  const endFlow = useCallback(() => {
    useSignerSessionStore.getState().endFlow()
    console.log('[Jollof] endFlow — flowId cleared')
  }, [])

  // ── Session-aware sendTransactions ────────────────────────────────────────

  /**
   * Drop-in for amvault-connect sendTransactions.
   * Injects session metadata at payload.session and touches session after success.
   *
   * @param txPayload  First arg (chainId, txs, preflight, …)
   * @param opts       Second arg (app, amvaultUrl, keepPopupOpen)
   * @param flowStep   Step label — 'bridge' | 'swap' | 'add_liquidity' | etc.
   */
  const sessionSendTransactions = useCallback(async (
    txPayload: any,
    opts: { app: string; amvaultUrl: string; keepPopupOpen?: boolean },
    flowStep?: string,
  ) => {
    // getOrCreateSignerSession logs "REUSED" or "NEW" — confirms same sessionId is in use
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

  /**
   * Drop-in for amvault-connect signMessage.
   * Injects session metadata at payload.session (flowStep = 'login').
   */
  const sessionSignMessage = useCallback(async (
    msgPayload: any,
    opts: { app: string; amvaultUrl: string },
  ) => {
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
