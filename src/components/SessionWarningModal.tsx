// src/components/SessionWarningModal.tsx
//
// "Stay signed in?" modal — shown when the AmVault signer session has
// less than 1 minute of idle time remaining.
// Lives in AppLayout so it can appear from any page.

import React from 'react'
import { useSignerSessionStore } from '../store/signerSessionStore'

export default function SessionWarningModal() {
  const { showWarning, touchSignerSession, clearSignerSession, setShowWarning } = useSignerSessionStore()

  if (!showWarning) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
        <h3 className="font-semibold text-lg mb-2 text-slate-900 dark:text-white">
          Stay signed in?
        </h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
          Your signing session expires in less than 1 minute. Confirm to stay signed in and
          avoid re-entering your passcode.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { touchSignerSession(); setShowWarning(false) }}
            className="flex-1 bg-jlfTomato hover:opacity-90 text-white font-medium py-2 px-4 rounded-xl transition-opacity"
          >
            Stay signed in
          </button>
          <button
            onClick={() => { clearSignerSession(); setShowWarning(false) }}
            className="flex-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium py-2 px-4 rounded-xl transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
