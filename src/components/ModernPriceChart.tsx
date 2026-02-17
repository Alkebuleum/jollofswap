import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    createChart,
    AreaSeries,
    ColorType,
    CrosshairMode,
    type IChartApi,
    type UTCTimestamp,
    ISeriesApi,
} from 'lightweight-charts'

type PricePoint = { t: number; p: number } // t in ms, p as number

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

function useTweenNumber(value: number, ms = 220) {
    const [v, setV] = useState(value)
    const prev = useRef(value)

    useEffect(() => {
        const from = prev.current
        const to = value
        prev.current = value

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

export default function ModernPriceChart({
    data,
    symbolLeft,
    symbolRight,
}: {
    data: PricePoint[]
    symbolLeft: string
    symbolRight: string
}) {
    const dark = useIsDarkMode()
    const hostRef = useRef<HTMLDivElement | null>(null)
    const tooltipRef = useRef<HTMLDivElement | null>(null)

    const chartRef = useRef<IChartApi | null>(null)
    const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

    const stats = useMemo(() => {
        if (!data || data.length < 2) return null
        const first = data[0].p
        const last = data[data.length - 1].p
        let hi = -Infinity
        let lo = Infinity
        for (const d of data) {
            if (d.p > hi) hi = d.p
            if (d.p < lo) lo = d.p
        }
        const chg = first > 0 ? ((last - first) / first) * 100 : 0
        return { first, last, hi, lo, chg }
    }, [data])

    const lastTween = useTweenNumber(stats?.last ?? 0)
    const chgTween = useTweenNumber(stats?.chg ?? 0)

    // Init chart once
    useEffect(() => {
        if (!hostRef.current) return

        const el = hostRef.current
        const chart = createChart(el, {
            width: Math.max(10, el.clientWidth),
            height: Math.max(10, el.clientHeight),
            crosshair: { mode: CrosshairMode.Normal },
            rightPriceScale: { borderVisible: false },
            timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
            grid: { vertLines: { visible: true }, horzLines: { visible: true } },
            handleScroll: true,
            handleScale: true,
        })

        const series = chart.addSeries(AreaSeries, {
            lineWidth: 2,
            lineColor: '#f97316',
            topColor: 'rgba(249, 115, 22, 0.25)',
            bottomColor: 'rgba(249, 115, 22, 0.02)',
        })


        chartRef.current = chart
        seriesRef.current = series

        const ro = new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect
            if (!cr) return
            chart.resize(Math.floor(cr.width), Math.floor(cr.height))
        })
        ro.observe(el)

        // Tooltip via crosshair
        chart.subscribeCrosshairMove((param) => {
            const tt = tooltipRef.current
            const s = seriesRef.current
            if (!tt || !s) return

            if (!param.point || !param.time) {
                tt.style.opacity = '0'
                return
            }

            const sd: any = param.seriesData.get(s)
            const price = sd?.value ?? sd?.close
            if (price == null) {
                tt.style.opacity = '0'
                return
            }

            const tSec = Number(param.time) * 1000
            const d = new Date(tSec)
            const timeLabel = d.toLocaleString(undefined, {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            })

            tt.style.opacity = '1'
            tt.innerHTML = `
        <div style="font-weight:700; font-size:12px; margin-bottom:4px;">
          1 ${symbolLeft} = ${Number(price).toPrecision(8)} ${symbolRight}
        </div>
        <div style="font-size:11px; opacity:.8;">${timeLabel}</div>
      `
        })

        return () => {
            ro.disconnect()
            chart.remove()
            chartRef.current = null
            seriesRef.current = null
        }
    }, [symbolLeft, symbolRight])

    // Theme updates
    useEffect(() => {
        const chart = chartRef.current
        if (!chart) return

        const bg = dark ? '#0b1220' : '#ffffff'
        const text = dark ? '#cbd5e1' : '#334155'
        const grid = dark ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.08)'

        chart.applyOptions({
            layout: { attributionLogo: false, background: { type: ColorType.Solid, color: bg }, textColor: text },
            grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        })
    }, [dark])

    // Data updates
    useEffect(() => {
        const series = seriesRef.current
        const chart = chartRef.current
        if (!series || !chart) return

        const mapped = (data || [])
            .filter((d) => Number.isFinite(d.p) && d.p > 0)
            .map((d) => ({
                time: Math.floor(d.t / 1000) as UTCTimestamp,
                value: d.p,
            }))

        series.setData(mapped)
        if (mapped.length > 2) chart.timeScale().fitContent()
    }, [data])

    const chgOk = (stats?.chg ?? 0) >= 0

    return (
        <div className="h-full w-full">
            {/* mini stats row */}
            <div className="mb-2 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Last</div>
                    <div className="tabular-nums text-sm font-extrabold text-slate-900 dark:text-slate-100">
                        {stats ? lastTween.toPrecision(8) : '—'}
                    </div>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/40">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">24h</div>
                    <div
                        className={[
                            'tabular-nums text-sm font-extrabold',
                            chgOk ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300',
                        ].join(' ')}
                    >
                        {stats ? `${chgTween >= 0 ? '+' : ''}${chgTween.toFixed(2)}%` : '—'}
                    </div>
                </div>
            </div>

            {/* chart host */}
            <div className="relative h-[180px] w-full">
                <div ref={hostRef} className="h-full w-full rounded-xl overflow-hidden" />

                {/* tooltip overlay */}
                <div
                    ref={tooltipRef}
                    className="pointer-events-none absolute left-3 top-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-slate-900 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 dark:text-slate-100"
                    style={{ opacity: 0, transition: 'opacity 120ms ease' }}
                />
            </div>
        </div>
    )
}
