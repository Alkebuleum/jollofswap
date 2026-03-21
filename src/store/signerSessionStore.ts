// src/store/signerSessionStore.ts
//
// JollofSwap is the single source of truth for the AmVault flow session.
// One stable sessionId lives for the whole 10-minute idle window and is
// reused across signin → signMessage → sendTransactions calls.

import { create } from 'zustand'

export const SESSION_IDLE_MS = 10 * 60 * 1000  // 10 minutes
export const FLOW_MIN_MS     =  5 * 60 * 1000  // minimum remaining time when a multi-step flow starts
export const WARN_MS         =      60 * 1000  // show warning at <= 1 minute remaining

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export type FlowSession = {
  sessionId: string
  startedAt: number
  lastActivityAt: number
  flowId: string | null
  flowStartedAt: number | null
}

type SignerSessionStore = {
  session: FlowSession | null
  showWarning: boolean

  /** Return existing session if still active, or create and return a fresh one. */
  getOrCreateSignerSession: () => FlowSession

  /** Update lastActivityAt after a successful AmVault response. */
  touchSignerSession: () => void

  /** Create a new flowId for a multi-step flow (bridge → swap, etc.).
   *  Always reuses the current sessionId.
   *  Also extends the idle window if less than FLOW_MIN_MS remains.
   *  @param flowLabel  Optional label used only for logging (e.g. 'bridge+swap') */
  startFlow: (flowLabel?: string) => FlowSession

  /** Clear flowId only — keeps the base session alive. */
  endFlow: () => void

  /** Wipe the entire session. */
  clearSignerSession: () => void

  /** True when session is absent or has been idle for >= SESSION_IDLE_MS. */
  isSignerSessionExpired: () => boolean

  setShowWarning: (v: boolean) => void
}

export const useSignerSessionStore = create<SignerSessionStore>((set, get) => ({
  session: null,
  showWarning: false,

  getOrCreateSignerSession() {
    const { session } = get()
    const now = Date.now()

    // Reuse if still active — NEVER rotate sessionId while session is valid
    if (session && now - session.lastActivityAt < SESSION_IDLE_MS) {
      console.log('[Jollof][session] getOrCreate → REUSED', { sessionId: session.sessionId, flowId: session.flowId ?? null, idleSec: Math.round((now - session.lastActivityAt) / 1000) })
      return session
    }

    // Expired or absent — create fresh only now
    const fresh: FlowSession = {
      sessionId: makeId(),
      startedAt: now,
      lastActivityAt: now,
      flowId: null,
      flowStartedAt: null,
    }
    set({ session: fresh, showWarning: false })
    console.log('[Jollof][session] getOrCreate → NEW', { sessionId: fresh.sessionId, reason: session ? 'expired' : 'none' })
    return fresh
  },

  touchSignerSession() {
    set(state => {
      if (!state.session) return {}
      return { session: { ...state.session, lastActivityAt: Date.now() }, showWarning: false }
    })
  },

  startFlow(flowLabel?: string) {
    const { getOrCreateSignerSession } = get()
    // getOrCreateSignerSession logs "REUSED" or "NEW" — sessionId never rotates if active
    const s = getOrCreateSignerSession()
    const now = Date.now()

    const remaining = SESSION_IDLE_MS - (now - s.lastActivityAt)

    // If remaining window is too short for a multi-step flow, extend it —
    // do NOT create a new sessionId, only push lastActivityAt back
    const lastActivityAt = remaining < FLOW_MIN_MS
      ? now - (SESSION_IDLE_MS - FLOW_MIN_MS)
      : s.lastActivityAt

    const updated: FlowSession = {
      ...s,           // sessionId, startedAt preserved from existing session
      lastActivityAt,
      flowId: makeId(),
      flowStartedAt: now,
    }
    set({ session: updated })
    console.log('[Jollof][session] startFlow', {
      label: flowLabel ?? 'multi-step',
      sessionId: updated.sessionId,
      flowId: updated.flowId,
      remainingSec: Math.round(remaining / 1000),
      extended: remaining < FLOW_MIN_MS,
    })
    return updated
  },

  endFlow() {
    set(state => {
      if (!state.session) return {}
      return { session: { ...state.session, flowId: null, flowStartedAt: null } }
    })
  },

  clearSignerSession() {
    set({ session: null, showWarning: false })
  },

  isSignerSessionExpired() {
    const { session } = get()
    if (!session) return true
    return Date.now() - session.lastActivityAt >= SESSION_IDLE_MS
  },

  setShowWarning(showWarning: boolean) {
    set({ showWarning })
  },
}))

/** Build the session metadata object to embed in any AmVault call payload. */
export function buildSessionMeta(
  s: FlowSession,
  flowStep?: string,
): Record<string, unknown> {
  return {
    sessionId: s.sessionId,
    ...(s.flowId ? { flowId: s.flowId } : {}),
    ...(flowStep  ? { flowStep }         : {}),
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
  }
}

/** Remaining idle ms for a session. */
export function getRemainingMs(s: FlowSession): number {
  return Math.max(0, SESSION_IDLE_MS - (Date.now() - s.lastActivityAt))
}
