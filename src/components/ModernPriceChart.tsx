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

type PricePoint = { t: number; p: number }
type TimeRange = '1H' | '1D' | '1W' | '1M' | '1Y'

// Design system constants — always dark
const BG       = '#101011'                        // var(--soft)
const SURFACE2 = '#1a1a1d'                        // var(--surface-2)
const LINE     = 'rgba(255,255,255,.045)'          // var(--line-2)
const MUTED    = '#8B867E'                         // var(--muted)
const WHITE    = '#FAFAF8'                         // var(--white)
const GREEN    = '#36D399'
const RED      = '#FF5A3C'

const RANGE_MS: Record<TimeRange, number> = {
    '1H':  1   * 60 * 60 * 1000,
    '1D':  24  * 60 * 60 * 1000,
    '1W':  7   * 24 * 60 * 60 * 1000,
    '1M':  30  * 24 * 60 * 60 * 1000,
    '1Y':  365 * 24 * 60 * 60 * 1000,
}

function fmtPrice(p: number): string {
    if (!isFinite(p) || p <= 0) return '—'
    if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 })
    if (p >= 100)   return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (p >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    if (p >= 0.0001) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
    return p.toExponential(4)
}

export default function ModernPriceChart({
    data,
    symbolFrom,
    symbolTo,
    usdHint,
}: {
    data: PricePoint[]
    symbolFrom: string
    symbolTo: string
    usdHint?: { sym: string; price: number }
}) {
    const hostRef    = useRef<HTMLDivElement | null>(null)
    const tooltipRef = useRef<HTMLDivElement | null>(null)
    const chartRef   = useRef<IChartApi | null>(null)
    const seriesRef  = useRef<ISeriesApi<'Area'> | null>(null)

    const [timeRange, setTimeRange] = useState<TimeRange>('1Y')

    // Keep refs so tooltip closure reads current symbols
    const baseRef  = useRef(symbolFrom)
    const quoteRef = useRef(symbolTo)
    useEffect(() => { baseRef.current  = symbolFrom }, [symbolFrom])
    useEffect(() => { quoteRef.current = symbolTo   }, [symbolTo])

    // Reset to 1Y when pair changes
    useEffect(() => { setTimeRange('1Y') }, [symbolFrom, symbolTo])

    // Filter by selected time range
    const displayData = useMemo(() => {
        const rangeMs = RANGE_MS[timeRange]
        const cutoff  = Date.now() - rangeMs
        return (data || []).filter(d => d.t >= cutoff && d.p > 0)
    }, [data, timeRange])

    // Stats derived from visible data
    const stats = useMemo(() => {
        if (displayData.length < 2) return null
        const prices = displayData.map(d => d.p)
        const first  = prices[0]
        const last   = prices[prices.length - 1]
        const high   = Math.max(...prices)
        const low    = Math.min(...prices)
        const chg    = first > 0 ? ((last - first) / first) * 100 : 0
        return { last, chg, high, low }
    }, [displayData])

    const isUp        = (stats?.chg ?? 0) >= 0
    const lineColor   = isUp ? GREEN : RED
    const topColor    = isUp ? 'rgba(54,211,153,0.20)' : 'rgba(255,90,60,0.18)'
    const bottomColor = isUp ? 'rgba(54,211,153,0.00)' : 'rgba(255,90,60,0.00)'

    // Init lightweight-charts once on mount
    useEffect(() => {
        let ro: ResizeObserver | null = null
        const timer = window.setTimeout(() => {
            if (!hostRef.current) return
            const el = hostRef.current

            const chart = createChart(el, {
                width:  Math.max(10, el.clientWidth),
                height: Math.max(10, el.clientHeight),
                crosshair: { mode: CrosshairMode.Normal },
                rightPriceScale: { borderVisible: false },
                timeScale: {
                    borderVisible: false,
                    timeVisible:   true,
                    secondsVisible: false,
                },
                grid: {
                    vertLines: { color: LINE },
                    horzLines: { color: LINE },
                },
                handleScroll: true,
                handleScale:  true,
                layout: {
                    attributionLogo: false,
                    background: { type: ColorType.Solid, color: BG },
                    textColor:  MUTED,
                    fontFamily: '"DM Mono", monospace',
                },
            })

            const series = chart.addSeries(AreaSeries, {
                lineWidth:   2,
                lineColor:   GREEN,
                topColor:    'rgba(54,211,153,0.20)',
                bottomColor: 'rgba(54,211,153,0.00)',
            })

            chartRef.current  = chart
            seriesRef.current = series

            ro = new ResizeObserver((entries) => {
                const cr = entries[0]?.contentRect
                if (cr) chart.resize(Math.floor(cr.width), Math.floor(cr.height))
            })
            ro.observe(el)

            chart.subscribeCrosshairMove((param) => {
                const tt = tooltipRef.current
                const s  = seriesRef.current
                if (!tt || !s) return
                if (!param.point || !param.time) { tt.style.opacity = '0'; return }
                const sd: any = param.seriesData.get(s)
                const price = sd?.value ?? sd?.close
                if (price == null) { tt.style.opacity = '0'; return }
                const d = new Date(Number(param.time) * 1000)
                const label = d.toLocaleString(undefined, {
                    month: 'short', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                })
                tt.style.opacity = '1'
                tt.innerHTML = `
                    <div style="font-weight:700;font-size:12px;margin-bottom:2px;">
                        1&nbsp;${baseRef.current}&nbsp;=&nbsp;${fmtPrice(Number(price))}&nbsp;${quoteRef.current}
                    </div>
                    <div style="font-size:11px;opacity:.6;">${label}</div>
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
    }, [])

    // Update series colors when direction changes
    useEffect(() => {
        seriesRef.current?.applyOptions({ lineColor, topColor, bottomColor })
    }, [lineColor, topColor, bottomColor])

    // Push data into chart whenever visible window changes
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
        push()
        const retry = window.setTimeout(push, 60)
        return () => window.clearTimeout(retry)
    }, [displayData])

    const noData = displayData.length < 2

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>

            {/* ── Chart header ── */}
            <div className="jlf-chart-head">
                <div>
                    <div className="jlf-pair-nm">
                        <b>{symbolFrom}&nbsp;/&nbsp;{symbolTo}</b>
                        {stats && (
                            <small>
                                {fmtPrice(stats.last)}
                                &ensp;
                                <span style={{ color: isUp ? GREEN : RED }}>
                                    {isUp ? '▲' : '▼'}&nbsp;{Math.abs(stats.chg).toFixed(2)}%
                                </span>
                            </small>
                        )}
                    </div>
                    {usdHint && (
                        <div style={{ marginTop: 4, fontFamily: '"DM Mono"', fontSize: 11.5, color: MUTED }}>
                            1&nbsp;{usdHint.sym}&nbsp;≈&nbsp;${fmtPrice(usdHint.price)}
                        </div>
                    )}
                </div>

                {stats && (
                    <div className="jlf-price-now">
                        <div className="px">{fmtPrice(stats.last)}</div>
                        <div className={`chg ${isUp ? 'up' : 'dn'}`}>
                            {isUp ? '▲' : '▼'}&nbsp;{Math.abs(stats.chg).toFixed(2)}%
                            &ensp;<span style={{ color: '#5B5853' }}>24h</span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Range tabs ── */}
            <div className="jlf-ranges">
                {(['1H', '1D', '1W', '1M', '1Y'] as const).map(r => (
                    <button
                        key={r}
                        className={timeRange === r ? 'active' : ''}
                        onClick={() => setTimeRange(r)}
                    >
                        {r}
                    </button>
                ))}
            </div>

            {/* ── Chart canvas ── */}
            <div style={{ position: 'relative', flex: 1, minHeight: 220, overflow: 'hidden' }}>
                <div
                    ref={hostRef}
                    style={{ position: 'absolute', inset: 0 }}
                />

                {noData && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(16,16,17,.7)',
                        fontSize: 13, color: MUTED, fontFamily: '"DM Mono"',
                    }}>
                        {data.length === 0 ? 'Waiting for on-chain data…' : 'No data for this period'}
                    </div>
                )}

                <div
                    ref={tooltipRef}
                    style={{
                        position: 'absolute', left: 8, top: 8, zIndex: 2,
                        background: SURFACE2, border: `1px solid rgba(255,255,255,.08)`,
                        borderRadius: 9, padding: '6px 10px',
                        fontFamily: '"DM Mono"', fontSize: 11.5, color: WHITE,
                        pointerEvents: 'none',
                        opacity: 0, transition: 'opacity 120ms ease',
                    }}
                />
            </div>

            {/* ── Stats strip ── */}
            {stats && (
                <div className="jlf-cstats">
                    <div className="jlf-cstat">
                        <small>High</small>
                        <b>{fmtPrice(stats.high)}</b>
                    </div>
                    <div className="jlf-cstat">
                        <small>Low</small>
                        <b>{fmtPrice(stats.low)}</b>
                    </div>
                    <div className="jlf-cstat">
                        <small>Points</small>
                        <b>{displayData.length}</b>
                    </div>
                    <div className="jlf-cstat">
                        <small>Change</small>
                        <b style={{ color: isUp ? GREEN : RED }}>
                            {isUp ? '+' : ''}{stats.chg.toFixed(2)}%
                        </b>
                    </div>
                </div>
            )}
        </div>
    )
}
