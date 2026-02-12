export const PREF = {
    HIDE_BALANCES: 'jswap:pref:hide_balances',
    SLIPPAGE_BPS: 'jswap:pref:slippage_bps',
    THEME: 'jswap:pref:theme', // 'light' | 'dark'
} as const

export function readHideBalances(): boolean {
    try {
        return localStorage.getItem(PREF.HIDE_BALANCES) === '1'
    } catch {
        return false
    }
}

export function writeHideBalances(v: boolean) {
    try {
        localStorage.setItem(PREF.HIDE_BALANCES, v ? '1' : '0')
    } catch { }
}

export function readSlippageBps(fallback = 50): number {
    try {
        const raw = localStorage.getItem(PREF.SLIPPAGE_BPS)
        const n = raw == null ? NaN : Number(raw)
        if (!Number.isFinite(n)) return fallback
        return Math.max(1, Math.min(2000, Math.floor(n))) // clamp 0.01%..20%
    } catch {
        return fallback
    }
}

export function writeSlippageBps(bps: number) {
    try {
        const n = Math.max(1, Math.min(2000, Math.floor(bps)))
        localStorage.setItem(PREF.SLIPPAGE_BPS, String(n))
    } catch { }
}

export type ThemePref = 'light' | 'dark'

export function readTheme(): ThemePref {
    try {
        const v = (localStorage.getItem(PREF.THEME) || '').toLowerCase()
        return v === 'dark' ? 'dark' : 'light'
    } catch {
        return 'light'
    }
}

export function writeTheme(v: ThemePref) {
    try {
        localStorage.setItem(PREF.THEME, v)
    } catch { }
}

export function applyTheme(next?: ThemePref) {
    if (typeof document === 'undefined') return
    const pref = next ?? readTheme()
    const isDark = pref === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
        // helps native form controls match theme
        ; (document.documentElement.style as any).colorScheme = isDark ? 'dark' : 'light'
}
