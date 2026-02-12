// src/lib/tokenRegistry.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ethers } from 'ethers'
import { db } from '../services/firebase'
import { TOKENS } from './jollofAmm'

const ZERO = '0x0000000000000000000000000000000000000000'

export type RegistryTokenRow = {
    chainId: number
    address: string
    symbol: string
    name: string
    decimals: number
    description?: string
    logoUrl?: string
    website?: string
    status?: string
    isNative?: boolean
    createdAtMs?: number
}

export type TokenMeta = RegistryTokenRow & {
    id: string // checksummed address OR "native:AKE"
    addressLower: string
}

type Ctx = {
    ready: boolean
    tokens: TokenMeta[]
    options: TokenMeta[] // same list, but sorted for dropdown
    byId: Record<string, TokenMeta>
    bySymbol: Record<string, TokenMeta[]> // symbols can collide; keep array
}

const TokenRegistryCtx = createContext<Ctx | null>(null)

function normalizeRow(r: any, chainId: number): TokenMeta | null {
    try {
        if (!r || Number(r.chainId) !== chainId) return null
        const symbol = String(r.symbol || '').trim().toUpperCase()
        if (!symbol) return null

        const rawAddr = String(r.address || '').trim()
        const addrLower = rawAddr.toLowerCase()
        const isNative = !!r.isNative || addrLower === ZERO

        const addr = isNative ? ZERO : ethers.getAddress(rawAddr)
        const id = isNative ? `native:${symbol}` : addr

        return {
            ...r,
            chainId,
            symbol,
            address: addr,
            addressLower: addr.toLowerCase(),
            isNative,
            id,
        } as TokenMeta
    } catch {
        return null
    }
}

function sortOptions(list: TokenMeta[]) {
    const pin = new Set(['native:ALKE', (TOKENS.MAH?.address || '').toLowerCase(), (TOKENS.ALKE?.address || '').toLowerCase()])
    return [...list].sort((a, b) => {
        const aPinned = pin.has(a.id.toLowerCase()) ? 0 : 1
        const bPinned = pin.has(b.id.toLowerCase()) ? 0 : 1
        if (aPinned !== bPinned) return aPinned - bPinned
        return a.symbol.localeCompare(b.symbol)
    })
}

export function TokenRegistryProvider({
    chainId,
    children,
}: {
    chainId: number
    children: React.ReactNode
}) {
    const [ready, setReady] = useState(false)
    const [rows, setRows] = useState<TokenMeta[]>([])

    useEffect(() => {
        setReady(false)

        const q = query(collection(db, 'tokens'), orderBy('createdAtMs', 'desc'), limit(500))
        const unsub = onSnapshot(
            q,
            (snap) => {
                const out: TokenMeta[] = []
                snap.forEach((d) => {
                    const t = normalizeRow(d.data(), chainId)
                    if (t) out.push(t)
                })

                // ✅ ensure AKE exists even if not registered yet
                const hasAKE = out.some((t) => t.id === 'native:ALKE')
                const withAKE = hasAKE
                    ? out
                    : [
                        {
                            chainId,
                            id: 'native:ALKE',
                            address: ZERO,
                            addressLower: ZERO,
                            symbol: 'ALKE',
                            name: 'Alkebuleum Gas Token',
                            decimals: 18,
                            isNative: true,
                            status: 'Core',
                        } as TokenMeta,
                        ...out,
                    ]

                // de-dupe by id
                const map = new Map<string, TokenMeta>()
                for (const t of withAKE) map.set(t.id.toLowerCase(), t)
                setRows(Array.from(map.values()))
                setReady(true)
            },
            () => {
                setRows([])
                setReady(true)
            }
        )

        return () => unsub()
    }, [chainId])

    const value: Ctx = useMemo(() => {
        const byId: Record<string, TokenMeta> = {}
        const bySymbol: Record<string, TokenMeta[]> = {}
        for (const t of rows) {
            byId[t.id] = t
            const k = t.symbol.toUpperCase()
            bySymbol[k] = bySymbol[k] || []
            bySymbol[k].push(t)
        }
        return {
            ready,
            tokens: rows,
            options: sortOptions(rows),
            byId,
            bySymbol,
        }
    }, [rows, ready])

    return <TokenRegistryCtx.Provider value={value}>{children}</TokenRegistryCtx.Provider>
}

export function useTokenRegistry() {
    const ctx = useContext(TokenRegistryCtx)
    if (!ctx) throw new Error('useTokenRegistry must be used within TokenRegistryProvider')
    return ctx
}
