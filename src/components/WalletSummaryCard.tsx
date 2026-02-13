import React from 'react'
import { Wallet } from 'lucide-react'

type Stat = { label: string; value: React.ReactNode }

function shortAddr(a?: string | null) {
    if (!a) return ''
    return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function StatPill({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-2xl bg-slate-50 px-4 py-2 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {label}
            </div>
            <div className="tabular-nums text-base font-extrabold text-slate-900 dark:text-slate-100">
                {value}
            </div>
        </div>
    )
}

export default function WalletSummaryCard({
    walletConnected,
    address,
    ain,
    stats,
    notConnectedHint,
}: {
    walletConnected: boolean
    address?: string | null
    ain?: string | number | null
    stats?: Stat[]
    notConnectedHint?: React.ReactNode
}) {
    const fullAddr = walletConnected && address ? address : null
    const displayAddr = fullAddr ? shortAddr(fullAddr) : '—'

    return (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                {/* LEFT: identity */}
                <div className="flex min-w-0 items-center gap-3">
                    <div className="relative">
                        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-50 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
                            <Wallet className="h-5 w-5 text-slate-700 dark:text-slate-200" />
                        </div>

                        {/* status dot */}
                        <span
                            className={[
                                'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2',
                                walletConnected
                                    ? 'bg-emerald-500 border-white dark:border-slate-900'
                                    : 'bg-slate-400 border-white dark:border-slate-900',
                            ].join(' ')}
                            title={walletConnected ? 'Connected' : 'Not connected'}
                        />
                    </div>

                    <div className="min-w-0">
                        {/* AIN (primary) */}
                        <div className="flex items-baseline gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                AIN
                            </div>
                            <div className="truncate font-mono text-sm font-extrabold text-slate-900 dark:text-slate-100">
                                {ain ? String(ain) : '—'}
                            </div>
                        </div>

                        {/* Address (secondary) */}
                        <div className="mt-0.5 flex min-w-0 items-center gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Address
                            </div>
                            <div className="truncate font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                                {displayAddr}
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: stats (grouped, cohesive) */}
                {!!stats?.length && (
                    <div className="flex items-stretch justify-end gap-2 sm:gap-3">
                        {stats.map((s) => (
                            <StatPill key={s.label} label={s.label} value={s.value} />
                        ))}
                    </div>
                )}
            </div>

            {!walletConnected && notConnectedHint ? (
                <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {notConnectedHint}
                </div>
            ) : null}
        </div>
    )
}
