// src/components/bridge/BridgeProgress.tsx
//
// Phase-based progress modal, styled like Swap.tsx's SwapProgressModal (this
// repo has no toast library — this is the established pattern). Shows the
// six-step flow from ALKEBRIDGE.md §7/§8, and both source + destination
// transaction hashes on completion (§7/§8 "completion state must show both").

import { ALKEBULEUM_EXPLORER, BSC_EXPLORER, type BridgeDirection } from '../../lib/bridge/config'
import { mapBridgeStateToMessage } from '../../lib/bridge/statusMessages'
import { isOperatorAttention, isTerminalSuccess } from '../../lib/bridge/api'

function explorerTxUrl(network: 'alkebuleum' | 'bsc', hash: string) {
  const base = network === 'alkebuleum' ? ALKEBULEUM_EXPLORER : BSC_EXPLORER
  return `${base.replace(/\/$/, '')}/tx/${hash}`
}

function shortHash(h: string) {
  return `${h.slice(0, 10)}…${h.slice(-6)}`
}

export type BridgeProgressProps = {
  direction: BridgeDirection
  submitPhase: 'idle' | 'submitting' | 'awaiting-receipt' | 'submitted' | 'error'
  submitError: string | null
  backendState: string | null
  awaitingDetection: boolean
  sourceTransactionHash: string | null
  destinationTransactionHash: string | null
  onClose: () => void
}

export default function BridgeProgress({
  direction,
  submitPhase,
  submitError,
  backendState,
  awaitingDetection,
  sourceTransactionHash,
  destinationTransactionHash,
  onClose,
}: BridgeProgressProps) {
  const sourceNet = direction === 'lock-to-mint' ? 'alkebuleum' : 'bsc'
  const destNet = direction === 'lock-to-mint' ? 'bsc' : 'alkebuleum'

  const isError = submitPhase === 'error'
  const isComplete = backendState != null && isTerminalSuccess(backendState)
  const needsAttention = backendState != null && isOperatorAttention(backendState)

  const statusLine = isError
    ? submitError ?? 'Bridge transaction failed.'
    : backendState
      ? mapBridgeStateToMessage(direction, backendState)
      : awaitingDetection
        ? 'Waiting for the bridge worker to detect your transaction…'
        : submitPhase === 'awaiting-receipt'
          ? 'Confirm the transaction in your wallet…'
          : 'Preparing transaction…'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        style={{ maxHeight: '90vh' }}
      >
        <div
          className={[
            'px-4 py-3',
            isComplete
              ? 'bg-green-50 dark:bg-green-950/30'
              : isError || needsAttention
                ? 'bg-red-50 dark:bg-red-950/30'
                : 'bg-orange-50 dark:bg-orange-950/20',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {isComplete ? 'Bridge complete' : isError ? 'Bridge failed' : needsAttention ? 'Needs attention' : 'Bridging ALKE'}
              </div>
              <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{statusLine}</div>
            </div>
            {(isComplete || isError || needsAttention) && (
              <button
                onClick={onClose}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {needsAttention && sourceTransactionHash && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              Source transaction: <span className="font-mono">{sourceTransactionHash}</span>
            </div>
          )}

          {!isError && !isComplete && !needsAttention && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-bold text-white">
                <span className="absolute inset-0 animate-ping rounded-full bg-orange-400 opacity-40" />
                <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
                  <path d="M14 8a6 6 0 00-6-6" strokeLinecap="round" />
                </svg>
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-300">{statusLine}</div>
            </div>
          )}

          <div className="space-y-2 text-sm">
            {sourceTransactionHash && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">
                  {direction === 'lock-to-mint' ? 'Alkebuleum lock transaction' : 'BNB Chain burn transaction'}
                </span>
                <a
                  href={explorerTxUrl(sourceNet, sourceTransactionHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-orange-600 hover:underline dark:text-orange-400"
                >
                  {shortHash(sourceTransactionHash)}
                </a>
              </div>
            )}
            {destinationTransactionHash && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">
                  {direction === 'lock-to-mint' ? 'BNB Chain mint transaction' : 'Alkebuleum release transaction'}
                </span>
                <a
                  href={explorerTxUrl(destNet, destinationTransactionHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-orange-600 hover:underline dark:text-orange-400"
                >
                  {shortHash(destinationTransactionHash)}
                </a>
              </div>
            )}
          </div>

          {isError && submitError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
              {submitError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
