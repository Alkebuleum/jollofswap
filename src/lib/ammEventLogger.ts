import { ethers } from 'ethers'
import { db } from '../services/firebase'
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { ensureFirebaseGuest } from '../services/firebaseGuest'


const PAIR_EVENTS_ABI = [
    'event Mint(address indexed sender,uint amount0,uint amount1)',
    'event Burn(address indexed sender,uint amount0,uint amount1,address indexed to)',
    'event Swap(address indexed sender,uint amount0In,uint amount1In,uint amount0Out,uint amount1Out,address indexed to)',
    'event Sync(uint112 reserve0,uint112 reserve1)',
]

const PAIR_META_ABI = ['function token0() view returns(address)', 'function token1() view returns(address)']


const pairIface = new ethers.Interface(PAIR_EVENTS_ABI)

// JSON-safe types (Firestore friendly)
type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue }

// BigInt -> string, ethers Result -> plain object/array
function toJsonSafe(v: unknown): JsonValue {
    if (v === null || v === undefined) return null

    const t = typeof v
    if (t === 'string' || t === 'number' || t === 'boolean') return v as JsonPrimitive
    if (t === 'bigint') return (v as bigint).toString()

    if (Array.isArray(v)) return v.map((x) => toJsonSafe(x))

    if (t === 'object') {
        const o = v as Record<string, unknown>
        const out: Record<string, JsonValue> = {}
        for (const [k, val] of Object.entries(o)) out[k] = toJsonSafe(val)
        return out
    }

    // fallback (symbol/function/etc)
    return String(v)
}

// Store only named inputs (stable + smaller than dumping ethers Result)
function namedArgs(parsed: ethers.LogDescription): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {}
    parsed.fragment.inputs.forEach((inp, idx) => {
        const key = inp.name && inp.name.length ? inp.name : `arg${idx}`
        out[key] = toJsonSafe((parsed.args as any)[idx])
    })
    return out
}

function dayKeyUtc(blockTimeSec: number) {
    // YYYY-MM-DD (UTC)
    return new Date(blockTimeSec * 1000).toISOString().slice(0, 10)
}

function hourKeyUtc(blockTimeSec: number) {
    // YYYY-MM-DDTHH (UTC)
    return new Date(blockTimeSec * 1000).toISOString().slice(0, 13)
}

export async function logAmmEventsFromReceipt(args: {
    provider: ethers.JsonRpcProvider
    chainId: number
    receipt: ethers.TransactionReceipt
    action: 'swap' | 'add_liquidity' | 'remove_liquidity' | 'admin_repair'
    user?: string | null
    ain?: string | null
    tokenA?: string
    tokenB?: string
    pairHint?: string | null
}) {
    await ensureFirebaseGuest()


    const { provider, chainId, receipt, action, user, ain, tokenA, tokenB, pairHint } = args

    const txHash = receipt.hash
    const blockNumber = receipt.blockNumber

    const blk = await provider.getBlock(blockNumber)
    const blockTime = blk?.timestamp ?? 0 // seconds
    const blockTimeMs = blockTime ? blockTime * 1000 : 0

    const batch = writeBatch(db)
    let wrote = 0

    for (const lg of receipt.logs) {
        if (pairHint && lg.address.toLowerCase() !== pairHint.toLowerCase()) continue

        let parsed: ethers.LogDescription | null = null
        try {
            parsed = pairIface.parseLog({ topics: lg.topics as string[], data: lg.data })
        } catch {
            continue
        }
        if (!parsed) continue

        const event = parsed.name // Mint | Burn | Swap | Sync
        if (!['Mint', 'Burn', 'Swap', 'Sync'].includes(event)) continue

        // deterministic dedupe
        const docId = `${chainId}_${txHash}_${lg.index}`
        const ref = doc(db, 'amm_events', docId)

        const pair = lg.address
        const pairC = new ethers.Contract(pair, PAIR_META_ABI, provider)
        const [token0, token1] = await Promise.all([pairC.token0(), pairC.token1()])

        const pairKey = `${chainId}_${pair.toLowerCase()}`

        batch.set(
            ref,
            {
                chainId,
                pair,
                pairKey,
                action,
                event,


                txHash,
                logIndex: lg.index,
                blockNumber,

                // ✅ time-series fields (graph-friendly)
                blockTime, // seconds
                blockTimeMs, // ms
                dayKey: blockTime ? dayKeyUtc(blockTime) : null,
                hourKey: blockTime ? hourKeyUtc(blockTime) : null,

                // context
                user: user ?? null,
                ain: ain ?? null,
                tokenA: tokenA ?? null,
                tokenB: tokenB ?? null,
                token0,
                token1,

                // event data
                args: namedArgs(parsed),

                createdAt: serverTimestamp(),
            },
            { merge: true }
        )

        wrote++
    }

    if (wrote > 0) await batch.commit()
    return wrote
}
