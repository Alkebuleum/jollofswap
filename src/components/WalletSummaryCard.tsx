import React from 'react'

type Stat = {
    label: string
    value: React.ReactNode
}

function shortAddr(a?: string | null) {
    if (!a) return ''
    return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
            <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{label}</div>
            <div className="tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100">{value}</div>
        </div>
    )
}

export default function WalletSummaryCard({
    walletConnected,
    address,
    stats,
    notConnectedHint,
    walletLabel = 'Wallet:',
}: {
    walletConnected: boolean
    address?: string | null
    stats?: Stat[]
    notConnectedHint?: React.ReactNode
    walletLabel?: string
}) {
    return (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-900 dark:text-slate-100">
                    <span className="font-semibold">{walletLabel}</span>{' '}
                    {walletConnected && address ? (
                        <span className="font-mono">{shortAddr(address)}</span>
                    ) : (
                        <span className="text-slate-500 dark:text-slate-400">Not connected</span>
                    )}
                </div>

                {!!stats?.length && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-0 sm:flex sm:items-center sm:gap-3">
                        {stats.map((s) => (
                            <MiniStat key={s.label} label={s.label} value={s.value} />
                        ))}
                    </div>
                )}
            </div>

            {!walletConnected && notConnectedHint ? (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{notConnectedHint}</div>
            ) : null}
        </div>
    )
}
