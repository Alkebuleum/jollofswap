import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    createChart,
    AreaSeries,
    ColorType,
    CrosshairMode,
    type IChartApi,
    type UTCTimestamp,
    type ISeriesApi,
} from 'lightweight-charts'
import { ArrowLeftRight } from 'lucide-react'

type PricePoint = { t: number; p: number } // t in ms, p = quote per base
type TimeRange = '1H' | '24H' | '1W'

const RANGE_MS: Record<TimeRange, number> = {
    '1H':  1 * 60 * 60 * 1000,
    '24H': 24 * 60 * 60 * 1000,
    '1W':  7 * 24 * 60 * 60 * 1000,
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useIsDarkMode() {
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setDark(el.classList.contains('dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])
    return dark
}

function useTweenNumber(value: number, ms = 200) {
    const [v, setV] = useState(value)
    const prev = useRef(value)
    useEffect(() => {
        const from = prev.current
        const to = value
        prev.current = value
        if (from === to) return
        const start = performance.now()
        let raf = 0
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / ms)
            setV(from + (to - from) * t)
            if (t < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [value, ms])
    return v
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtPrice(p: number): string {
    if (!isFinite(p) || p <= 0) return '—'
    if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
    if (p >= 100)   return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (p >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    if (p >= 0.0001) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
    return p.toExponential(4)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModernPriceChart({
    data,
    symbolFrom,
    symbolTo,
    usdHint,
}: {
    data: PricePoint[]
    symbolFrom: string
    symbolTo: string
    /** Optional USD price of the non-stable token — shown as a secondary hint */
    usdHint?: { sym: string; price: number }
}) {
    const dark    = useIsDarkMode()
    const darkRef = useRef(dark)
    useEffect(() => { darkRef.current = dark }, [dark])
    const hostRef    = useRef<HTMLDivElement | null>(null)
    const tooltipRef = useRef<HTMLDivElement | null>(null)
    const chartRef   = useRef<IChartApi | null>(null)
    const seriesRef  = useRef<ISeriesApi<'Area'> | null>(null)

    const [flipped, setFlipped]       = useState(false)
    const [timeRange, setTimeRange]   = useState<TimeRange>('1W')

    // Reset flip when the token pair changes
    useEffect(() => { setFlipped(false) }, [symbolFrom, symbolTo])

    // Which token is "base" (1 of this = X of the other)
    const baseSymbol  = flipped ? symbolTo   : symbolFrom
    const quoteSymbol = flipped ? symbolFrom : symbolTo

    // Keep refs so the tooltip closure always reads current symbols without re-subscribing
    const baseRef  = useRef(baseSymbol)
    const quoteRef = useRef(quoteSymbol)
    useEffect(() => { baseRef.current  = baseSymbol  }, [baseSymbol])
    useEffect(() => { quoteRef.current = quoteSymbol }, [quoteSymbol])

    // Filter by time range, then apply flip
    const displayData = useMemo(() => {
        const cutoff = Date.now() - RANGE_MS[timeRange]
        const filtered = (data || []).filter(d => d.t >= cutoff && d.p > 0)
        if (flipped) return filtered.map(d => ({ t: d.t, p: 1 / d.p }))
        return filtered
    }, [data, timeRange, flipped])

    // Stats for the current window
    const stats = useMemo(() => {
        if (displayData.length < 2) return null
        const first = displayData[0].p
        const last  = displayData[displayData.length - 1].p
        const chg   = first > 0 ? ((last - first) / first) * 100 : 0
        return { last, chg }
    }, [displayData])

    const priceTween = useTweenNumber(stats?.last ?? 0)
    const chgTween   = useTweenNumber(stats?.chg  ?? 0)
    const chgOk      = (stats?.chg ?? 0) >= 0

    // ── Init chart once on mount ─────────────────────────────────────────────
    useEffect(() => {
        let ro: ResizeObserver | null = null

        // Defer one tick so the flex layout has settled and the div has real pixel dimensions
        const timer = window.setTimeout(() => {
            if (!hostRef.current) return
            const el = hostRef.current

            const isDark = darkRef.current
            const bg   = isDark ? '#0b1220' : '#ffffff'
            const text = isDark ? '#cbd5e1' : '#334155'
            const grid = isDark ? 'rgba(148,163,184,0.09)' : 'rgba(15,23,42,0.07)'

            const chart = createChart(el, {
                width:     Math.max(10, el.clientWidth),
                height:    Math.max(10, el.clientHeight),
                crosshair: { mode: CrosshairMode.Normal },
                rightPriceScale: { borderVisible: false },
                timeScale:       { borderVisible: false, timeVisible: true, secondsVisible: false },
                grid: { vertLines: { color: grid }, horzLines: { color: grid } },
                handleScroll: true,
                handleScale:  true,
                layout: { attributionLogo: false, background: { type: ColorType.Solid, color: bg }, textColor: text },
            })

            const series = chart.addSeries(AreaSeries, {
                lineWidth:   2,
                lineColor:   '#f97316',
                topColor:    'rgba(249,115,22,0.22)',
                bottomColor: 'rgba(249,115,22,0.02)',
            })

            chartRef.current  = chart
            seriesRef.current = series

            ro = new ResizeObserver((entries) => {
                const cr = entries[0]?.contentRect
                if (cr) chart.resize(Math.floor(cr.width), Math.floor(cr.height))
            })
            ro.observe(el)

            // Tooltip — reads baseRef/quoteRef so it stays current without re-subscribing
            chart.subscribeCrosshairMove((param) => {
                const tt = tooltipRef.current
                const s  = seriesRef.current
                if (!tt || !s) return

                if (!param.point || !param.time) { tt.style.opacity = '0'; return }

                const sd: any = param.seriesData.get(s)
                const price = sd?.value ?? sd?.close
                if (price == null) { tt.style.opacity = '0'; return }

                const d = new Date(Number(param.time) * 1000)
                const timeLabel = d.toLocaleString(undefined, {
                    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                })

                tt.style.opacity = '1'
                tt.innerHTML = `
                    <div style="font-weight:700;font-size:12px;margin-bottom:3px;">
                        1&nbsp;${baseRef.current}&nbsp;=&nbsp;${fmtPrice(Number(price))}&nbsp;${quoteRef.current}
                    </div>
                    <div style="font-size:11px;opacity:.7;">${timeLabel}</div>
                `
            })
        }, 0)

        return () => {
            window.clearTimeout(timer)
            ro?.disconnect()
            chartRef.current?.remove()
            chartRef.current  = null
            seriesRef.current = null
        }
    }, []) // init once only

    // ── Theme ─────────────────────────────────────────────────────────────────
    useEffect(() => {
        const chart = chartRef.current
        if (!chart) return
        const bg   = dark ? '#0b1220' : '#ffffff'
        const text = dark ? '#cbd5e1' : '#334155'
        const grid = dark ? 'rgba(148,163,184,0.09)' : 'rgba(15,23,42,0.07)'
        chart.applyOptions({
            layout: { attributionLogo: false, background: { type: ColorType.Solid, color: bg }, textColor: text },
            grid:   { vertLines: { color: grid }, horzLines: { color: grid } },
        })
    }, [dark])

    // ── Data ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        function push() {
            const series = seriesRef.current
            const chart  = chartRef.current
            if (!series || !chart) return

            const mapped = displayData.map(d => ({
                time:  Math.floor(d.t / 1000) as UTCTimestamp,
                value: d.p,
            }))

            series.setData(mapped)
            if (mapped.length > 1) chart.timeScale().fitContent()
        }

        // Try immediately; if the chart hasn't initialized yet (0ms defer still pending),
        // retry after the defer has had time to fire.
        push()
        const retry = window.setTimeout(push, 50)
        return () => window.clearTimeout(retry)
    }, [displayData])

    const noData = displayData.length < 2

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex h-full w-full flex-col">

            {/* ── Header row ── */}
            <div className="flex items-start justify-between gap-2">

                {/* Left: pair label + live price + change + USD hint */}
                <div className="min-w-0">
                    {/* Pair label + flip button */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {baseSymbol}&nbsp;/&nbsp;{quoteSymbol}
                        </span>
                        <button
                            onClick={() => setFlipped(f => !f)}
                            title={`Flip to ${quoteSymbol} / ${baseSymbol}`}
                            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                            <ArrowLeftRight className="h-3 w-3" />
                        </button>
                    </div>

                    {/* Current price — large */}
                    <div className="mt-0.5 text-2xl font-extrabold tabular-nums leading-none text-slate-900 dark:text-slate-100">
                        {stats ? fmtPrice(priceTween) : '—'}
                    </div>

                    {/* Change % + USD hint */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={[
                            'text-xs font-semibold tabular-nums',
                            stats
                                ? chgOk
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-400',
                        ].join(' ')}>
                            {stats ? `${chgTween >= 0 ? '+' : ''}${chgTween.toFixed(2)}%` : '—'}
                        </span>

                        {usdHint && (
                            <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
                                ≈&nbsp;${fmtPrice(usdHint.price)}&nbsp;per&nbsp;{usdHint.sym}
                            </span>
                        )}
                    </div>
                </div>

                {/* Right: time range tabs */}
                <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                    {(['1H', '24H', '1W'] as const).map(r => (
                        <button
                            key={r}
                            onClick={() => setTimeRange(r)}
                            className={[
                                'rounded-md px-2.5 py-1 text-xs font-semibold transition',
                                timeRange === r
                                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                            ].join(' ')}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Chart area ── canvas always stays mounted so lightweight-charts can init */}
            <div className="relative mt-3 flex-1 min-h-[140px]">
                <div ref={hostRef} className="h-full w-full overflow-hidden rounded-xl" />

                {/* "No data" overlay — sits on top of the canvas, never unmounts the canvas */}
                {noData && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80 text-xs text-slate-400 dark:bg-slate-950/80 dark:text-slate-500">
                        No data for this period
                    </div>
                )}

                <div
                    ref={tooltipRef}
                    className="pointer-events-none absolute left-2 top-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-slate-900 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 dark:text-slate-100"
                    style={{ opacity: 0, transition: 'opacity 120ms ease' }}
                />
            </div>
        </div>
    )
}
