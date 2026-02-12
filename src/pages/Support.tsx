// src/pages/Support.tsx
import React from 'react'

const ALK_EXPLORER = (import.meta.env.VITE_ALK_EXPLORER as string) ?? ''
const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string) ?? 'https://alkebuleum.org'
const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string) ?? 'info@alkebuleum.org'
const STATUS_URL = (import.meta.env.VITE_STATUS_URL as string) ?? '' // optional

function LinkRow({ label, href }: { label: string; href: string }) {
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
    >
      <span>{label}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">Open</span>
    </a>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</div>
      <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">{children}</div>
    </div>
  )
}

export default function Support() {
  return (
    <div className="page">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
            Support
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Help for amVault, swaps, liquidity, and bridge status.
          </p>
        </div>

        <div className="grid gap-4">
          <Section title="Before you do anything">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Make sure you’re connected to <span className="font-semibold text-slate-900 dark:text-slate-100">amVault</span> from the top bar.
              </li>
              <li>
                Ensure you have enough <span className="font-semibold text-slate-900 dark:text-slate-100">AKE</span> for gas (or allow the app’s gas top-up if enabled).
              </li>
              <li>
                Confirm you’re on the correct network: <span className="font-semibold text-slate-900 dark:text-slate-100">Alkebuleum</span>.
              </li>
            </ul>
          </Section>

          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Swaps not going through">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  If you see <span className="font-semibold text-slate-900 dark:text-slate-100">reverted</span>, reduce trade size or increase slippage slightly.
                </li>
                <li>
                  If it’s an ERC-20 token, you may need an <span className="font-semibold text-slate-900 dark:text-slate-100">approve</span> transaction first.
                </li>
                <li>
                  “Insufficient balance” usually means wallet balance or allowance is too low.
                </li>
              </ul>
            </Section>

            <Section title="Liquidity issues">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  First liquidity sets the pool price. After that, amounts must match the pool ratio.
                </li>
                <li>
                  If a tx reverts, check the on-screen confirmation list to see which step failed (approve vs add/remove).
                </li>
                <li>
                  If “not confirmed”, refresh and check explorer (RPC delay can happen).
                </li>
              </ul>
            </Section>
          </div>

          <Section title="Bridge deposits / MAH minting">
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Deposits require confirmations on the source chain before minting starts.
              </li>
              <li>
                If it’s taking longer than expected, copy your deposit tx hash and check confirmations in explorer.
              </li>
              <li>
                If confirmations are complete but mint still hasn’t happened, email support with your tx hash.
              </li>
            </ul>
          </Section>

          <Section title="Contact">
            <div className="space-y-2">
              <div>
                Email:{' '}
                <a
                  className="font-semibold underline text-slate-900 dark:text-slate-100"
                  href={`mailto:${SUPPORT_EMAIL}`}
                >
                  {SUPPORT_EMAIL}
                </a>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Include: your wallet address, page (Swap/Liquidity/Bridge), and tx hash (if available).
              </div>
            </div>
          </Section>

          <div className="grid gap-3 md:grid-cols-2">
            <LinkRow label="Docs" href={DOCS_URL} />
            <LinkRow label="Explorer" href={ALK_EXPLORER} />
            <LinkRow label="Status" href={STATUS_URL} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
            Tip: If you see a revert reason like <span className="font-mono">RouterError: ...</span>, copy it into your support message.
          </div>
        </div>
      </div>
    </div>
  )
}
