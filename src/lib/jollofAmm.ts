// src/lib/jollofAmm.ts
import { ethers, Interface, MaxUint256 } from 'ethers'

// ---- Chain + core contracts ----
export const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)
export const ALK_RPC = (import.meta.env.VITE_ALK_RPC as string) ?? 'https://rpc.alkebuleum.com'

export const FACTORY = (import.meta.env.VITE_JOLLOF_FACTORY_ALK as string) ?? ''
export const ROUTER = (import.meta.env.VITE_JOLLOF_ROUTER_ALK as string) ?? ''
export const WAKE = (import.meta.env.VITE_WAKE_ALK as string) ?? '' // wrapped native AKE

export const TREASURY = (import.meta.env.VITE_JOLLOF_TREASURY_ALK as string) ?? ''
export const REFERRER_REGISTRY = (import.meta.env.VITE_REFERRER_REGISTRY_ALK as string) ?? ''
export const GAS_PRICE_WEI = 5_000_000_000n // 5 gwei (same as Hardhat)
export const GAS_LIMIT_APPROVE = 2_000_000
export const GAS_LIMIT_ROUTER = 8_000_000

export function legacyGasFields(gasLimit: number) {
    return {
        type: 0,
        gasLimit,
        gasPrice: ethers.toBeHex(GAS_PRICE_WEI),
        // also set "gas" for JSON-RPC style clients that prefer it
        gas: gasLimit,
    }
}

// ---- Tokens ----
export type TokenKey = 'MAH' | 'ALKE' | 'JLF'
export type TokenInfo = {
    key: TokenKey
    symbol: TokenKey
    decimalsHint: number
    address?: string // undefined for native
    isNative?: boolean
    wrapped?: string // WAKE for native path
}

const MAH = (import.meta.env.VITE_TOKEN_MAH_ALK as string) ?? ''
const JLF = (import.meta.env.VITE_TOKEN_JLF_ALK as string) ?? ''
const mAH = (import.meta.env.VITE_TOKEN_mAH_ALK as string) ?? ''

export const TOKENS: Record<TokenKey, TokenInfo> = {
    MAH: { key: 'MAH', symbol: 'MAH', decimalsHint: 18, address: MAH || undefined },
    JLF: { key: 'JLF', symbol: 'JLF', decimalsHint: 18, address: JLF || undefined },
    ALKE: { key: 'ALKE', symbol: 'ALKE', decimalsHint: 18, isNative: true, wrapped: WAKE || undefined },
}

export function enabledTokenKeys(): TokenKey[] {
    return (Object.keys(TOKENS) as TokenKey[]).filter((k) => {
        const t = TOKENS[k]
        if (t.isNative) return !!t.wrapped
        return !!t.address
    })
}

export function assertCoreConfig() {
    if (!ROUTER) throw new Error('Missing VITE_JOLLOF_ROUTER_ALK')
    if (!FACTORY) throw new Error('Missing VITE_JOLLOF_FACTORY_ALK')
    // NOTE: wrapped native (WAKE) can come from registry token metadata.
}


// ---- ABIs ----
const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
]

const FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address)']

const ROUTER_ABI = [
    'function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)',
    'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) returns (uint256[] memory amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) payable returns (uint256[] memory amounts)',
    'function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] calldata path,address to,uint256 deadline) returns (uint256[] memory amounts)',
    'function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB,uint256 liquidity)',
    'function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)',
]

const PAIR_VIEW_ABI = [
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function getReserves() view returns (uint112,uint112,uint32)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
]

export const routerIface = new Interface(ROUTER_ABI)
export const erc20Iface = new Interface(ERC20_ABI)

// ---- Providers ----
export function readProvider() {
    return new ethers.JsonRpcProvider(ALK_RPC, ALK_CHAIN_ID)
}

// ---- Helpers ----
// returns the address that should be used in router paths/pairs
export function tokenAddressForPath(token: { address?: string; isNative?: boolean; symbol?: string }) {
    // If it's native, we still need the WRAPPED address for paths.
    // ✅ Prefer the address on the token object (from registry).
    if (token?.isNative) {
        const w = (token as any)?.wrapped ?? token?.address ?? ''
        if (w && ethers.isAddress(w) && w !== ethers.ZeroAddress) return ethers.getAddress(w)

        const envWake = (import.meta as any).env?.VITE_WAKE_ALK as string | undefined
        if (envWake && ethers.isAddress(envWake) && envWake !== ethers.ZeroAddress) return ethers.getAddress(envWake)

        throw new Error('Missing wrapped native token (WAKE). Add WAKE to registry (native token address = WAKE) or set VITE_WAKE_ALK.')
    }


    const addr = token?.address ?? ''
    if (!addr || !ethers.isAddress(addr) || addr === ethers.ZeroAddress) {
        throw new Error(`Invalid token address for ${token?.symbol ?? 'token'}`)
    }
    return ethers.getAddress(addr)
}

export function clampAmountStr(v: string) {
    return v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
}

export function fmtNum(s: string) {
    const n = Number(s)
    if (!Number.isFinite(n)) return s
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export function applySlippage(amount: bigint, slippageBps: number) {
    const bps = BigInt(Math.max(0, Math.min(5000, slippageBps)))
    return (amount * (10_000n - bps)) / 10_000n
}

export async function readDecimals(token: TokenInfo, provider = readProvider()): Promise<number> {
    if (token.isNative) return 18
    if (!token.address) throw new Error(`Missing address for ${token.symbol}`)
    const erc20 = new ethers.Contract(token.address, ERC20_ABI, provider)
    return (await erc20.decimals()) as number
}

export async function getBalance(owner: string, token: TokenInfo, provider = readProvider()): Promise<bigint> {
    if (token.isNative) return provider.getBalance(owner)
    if (!token.address) return 0n
    const erc20 = new ethers.Contract(token.address, ERC20_ABI, provider)
    return (await erc20.balanceOf(owner)) as bigint
}

export async function getAllowance(owner: string, token: TokenInfo, spender: string, provider = readProvider()) {
    if (token.isNative) return MaxUint256
    if (!token.address) return 0n
    const erc20 = new ethers.Contract(token.address, ERC20_ABI, provider)
    return (await erc20.allowance(owner, spender)) as bigint
}

export async function getPairAddress(tokenA: TokenInfo, tokenB: TokenInfo, provider = readProvider()): Promise<string> {
    assertCoreConfig()
    const a = tokenAddressForPath(tokenA)
    const b = tokenAddressForPath(tokenB)
    const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider)
    return (await factory.getPair(a, b)) as string
}

// Back-compat (your current UI uses this)
export async function getLpPosition(params: { owner: string; tokenA: TokenInfo; tokenB: TokenInfo }) {
    const provider = readProvider()
    const pair = await getPairAddress(params.tokenA, params.tokenB, provider)
    if (!pair || pair === ethers.ZeroAddress) return { pair, lpBalance: 0n, totalSupply: 0n, shareBps: 0 }

    const p = new ethers.Contract(pair, PAIR_VIEW_ABI, provider)
    const [lpBalance, totalSupply] = await Promise.all([
        p.balanceOf(params.owner) as Promise<bigint>,
        p.totalSupply() as Promise<bigint>,
    ])

    const shareBps = totalSupply > 0n ? Number((lpBalance * 10_000n) / totalSupply) : 0
    return { pair, lpBalance, totalSupply, shareBps }
}

/**
 * New: single call that returns reserves + (optional) owner LP balance/share.
 * This is what we’ll use to show “liquidity available” on the UI.
 */
export async function getLpDetails(params: { tokenA: TokenInfo; tokenB: TokenInfo; owner?: string; provider?: any }) {
    const provider = params.provider ?? readProvider()
    const pair = await getPairAddress(params.tokenA, params.tokenB, provider)
    if (!pair || pair === ethers.ZeroAddress) {
        return {
            pair: ethers.ZeroAddress,
            token0: ethers.ZeroAddress,
            token1: ethers.ZeroAddress,
            reserve0: 0n,
            reserve1: 0n,
            totalSupply: 0n,
            lpBalance: 0n,
            shareBps: 0,
        }
    }

    const p = new ethers.Contract(pair, PAIR_VIEW_ABI, provider)
    const [token0, token1, reserves, totalSupply, lpBalance] = await Promise.all([
        p.token0() as Promise<string>,
        p.token1() as Promise<string>,
        p.getReserves() as Promise<[bigint, bigint, number]>,
        p.totalSupply() as Promise<bigint>,
        params.owner ? (p.balanceOf(params.owner) as Promise<bigint>) : Promise.resolve(0n),
    ])

    const reserve0 = reserves[0]
    const reserve1 = reserves[1]
    const shareBps = totalSupply > 0n ? Number((lpBalance * 10_000n) / totalSupply) : 0

    return { pair, token0, token1, reserve0, reserve1, totalSupply, lpBalance, shareBps }
}

export function alignReservesToSelected(
    tokenA: TokenInfo,
    tokenB: TokenInfo,
    token0: string,
    reserve0: bigint,
    reserve1: bigint
) {
    const addrA = tokenAddressForPath(tokenA).toLowerCase()
    const t0 = token0.toLowerCase()

    // if A is token0 -> A uses reserve0, else A uses reserve1
    const reserveA = addrA === t0 ? reserve0 : reserve1
    const reserveB = addrA === t0 ? reserve1 : reserve0
    return { reserveA, reserveB }
}

export function underlyingForLp(params: {
    lpBalance: bigint
    totalSupply: bigint
    reserveA: bigint
    reserveB: bigint
}) {
    if (params.totalSupply === 0n || params.lpBalance === 0n) return { amountA: 0n, amountB: 0n }
    const amountA = (params.reserveA * params.lpBalance) / params.totalSupply
    const amountB = (params.reserveB * params.lpBalance) / params.totalSupply
    return { amountA, amountB }
}

export async function getQuoteOut(params: { from: TokenInfo; to: TokenInfo; amountIn: bigint }) {
    assertCoreConfig()
    const provider = readProvider()
    const router = new ethers.Contract(ROUTER, ROUTER_ABI, provider)
    const path = [tokenAddressForPath(params.from), tokenAddressForPath(params.to)]
    const amounts: bigint[] = await router.getAmountsOut(params.amountIn, path)
    return { path, amountOut: amounts[amounts.length - 1] }
}

// --- Liquidity planning helpers (prevents InsufficientA/B reverts) ---

export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint) {
    if (amountA === 0n) return 0n
    if (reserveA === 0n || reserveB === 0n) return 0n
    return (amountA * reserveB) / reserveA
}

export function computeOptimalLiquidityAmounts(params: {
    amountADesired: bigint
    amountBDesired: bigint
    reserveA: bigint
    reserveB: bigint
}) {
    const { amountADesired, amountBDesired, reserveA, reserveB } = params

    // new pool or empty reserves -> take desired
    if (reserveA === 0n && reserveB === 0n) {
        return { amountA: amountADesired, amountB: amountBDesired }
    }

    const amountBOptimal = quote(amountADesired, reserveA, reserveB)
    if (amountBOptimal <= amountBDesired) {
        return { amountA: amountADesired, amountB: amountBOptimal }
    }

    const amountAOptimal = quote(amountBDesired, reserveB, reserveA)
    return { amountA: amountAOptimal, amountB: amountBDesired }
}

export async function getReservesAligned(params: {
    tokenA: TokenInfo
    tokenB: TokenInfo
    provider?: any
}) {
    const provider = params.provider ?? readProvider()
    const pair = await getPairAddress(params.tokenA, params.tokenB, provider)

    if (!pair || pair === ethers.ZeroAddress) {
        return {
            pair: ethers.ZeroAddress,
            token0: ethers.ZeroAddress,
            reserve0: 0n,
            reserve1: 0n,
            reserveA: 0n,
            reserveB: 0n,
        }
    }

    const p = new ethers.Contract(pair, PAIR_VIEW_ABI, provider)
    const [token0, reserves] = await Promise.all([
        p.token0() as Promise<string>,
        p.getReserves() as Promise<[bigint, bigint, number]>,
    ])

    const reserve0 = reserves[0]
    const reserve1 = reserves[1]

    const { reserveA, reserveB } = alignReservesToSelected(
        params.tokenA,
        params.tokenB,
        token0,
        reserve0,
        reserve1
    )

    return { pair, token0, reserve0, reserve1, reserveA, reserveB }
}

export async function planAddLiquidity(params: {
    tokenA: TokenInfo
    tokenB: TokenInfo
    amountADesired: bigint
    amountBDesired: bigint
    slippageBps: number
    provider?: any
}) {
    const provider = params.provider ?? readProvider()
    const { pair, reserveA, reserveB } = await getReservesAligned({
        tokenA: params.tokenA,
        tokenB: params.tokenB,
        provider,
    })

    let usedA = params.amountADesired
    let usedB = params.amountBDesired

    // only compute optimal when pool exists and has reserves
    if (pair !== ethers.ZeroAddress && (reserveA > 0n || reserveB > 0n)) {
        const opt = computeOptimalLiquidityAmounts({
            amountADesired: params.amountADesired,
            amountBDesired: params.amountBDesired,
            reserveA,
            reserveB,
        })
        usedA = opt.amountA
        usedB = opt.amountB
    }

    const minA = applySlippage(usedA, params.slippageBps)
    const minB = applySlippage(usedB, params.slippageBps)

    // IMPORTANT: for native leg, send EXACT used value to avoid refund -> EthTransferFailed on smart wallets
    const nativeValue =
        params.tokenA.isNative ? usedA : params.tokenB.isNative ? usedB : 0n

    return {
        pair,
        reserveA,
        reserveB,
        usedA,
        usedB,
        minA,
        minB,
        nativeValue,
    }
}


// ---- TX builders (BigInt-safe for amvault-connect JSON serialization) ----
function hexValue(x: bigint | number) {
    if (typeof x === 'bigint') return ethers.toBeHex(x)
    return x === 0 ? '0x0' : ethers.toBeHex(BigInt(x))
}

export function buildApproveTx(token: TokenInfo, spender: string, amount: bigint) {
    if (token.isNative) return null
    if (!token.address) throw new Error(`Missing address for ${token.symbol}`)
    const data = erc20Iface.encodeFunctionData('approve', [spender, amount])
    return {
        to: token.address,
        data,
        value: '0x0',
        ...legacyGasFields(GAS_LIMIT_APPROVE),
    }
}


export function buildSwapTx(params: {
    from: TokenInfo
    to: TokenInfo
    amountIn: bigint
    amountOutMin: bigint
    path: string[]
    recipient: string
    deadlineSec: number
}) {
    assertCoreConfig()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + params.deadlineSec)

    if (params.from.isNative) {
        const data = routerIface.encodeFunctionData('swapExactETHForTokens', [
            params.amountOutMin,
            params.path,
            params.recipient,
            deadline,
        ])
        return { to: ROUTER, data, value: hexValue(params.amountIn), gas: 520_000 }
    }

    if (params.to.isNative) {
        const data = routerIface.encodeFunctionData('swapExactTokensForETH', [
            params.amountIn,
            params.amountOutMin,
            params.path,
            params.recipient,
            deadline,
        ])
        return { to: ROUTER, data, value: '0x0', gas: 600_000 }
    }

    const data = routerIface.encodeFunctionData('swapExactTokensForTokens', [
        params.amountIn,
        params.amountOutMin,
        params.path,
        params.recipient,
        deadline,
    ])
    return { to: ROUTER, data, value: '0x0', gas: 600_000 }
}

export function buildAddLiquidityTx(params: {
    tokenA: TokenInfo
    tokenB: TokenInfo
    amountA: bigint
    amountB: bigint
    amountAMin: bigint
    amountBMin: bigint
    recipient: string
    deadlineSec: number
    valueNative?: bigint // ✅ optional override for addLiquidityETH msg.value
}) {
    assertCoreConfig()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + params.deadlineSec)

    // native A side (AKE)
    if (params.tokenA.isNative) {
        if (!params.tokenB.address) throw new Error(`Missing address for ${params.tokenB.symbol}`)
        const data = routerIface.encodeFunctionData('addLiquidityETH', [
            params.tokenB.address,
            params.amountB,
            params.amountBMin,
            params.amountAMin,
            params.recipient,
            deadline,
        ])
        const v = params.valueNative ?? params.amountA
        return { to: ROUTER, data, value: hexValue(v), ...legacyGasFields(GAS_LIMIT_ROUTER) }
    }

    // native B side (AKE)
    if (params.tokenB.isNative) {
        if (!params.tokenA.address) throw new Error(`Missing address for ${params.tokenA.symbol}`)
        const data = routerIface.encodeFunctionData('addLiquidityETH', [
            params.tokenA.address,
            params.amountA,
            params.amountAMin,
            params.amountBMin,
            params.recipient,
            deadline,
        ])
        const v = params.valueNative ?? params.amountB
        return { to: ROUTER, data, value: hexValue(v), ...legacyGasFields(GAS_LIMIT_ROUTER) }
    }

    // token-token
    if (!params.tokenA.address || !params.tokenB.address) throw new Error('Missing token address')
    const data = routerIface.encodeFunctionData('addLiquidity', [
        params.tokenA.address,
        params.tokenB.address,
        params.amountA,
        params.amountB,
        params.amountAMin,
        params.amountBMin,
        params.recipient,
        deadline,
    ])
    return { to: ROUTER, data, value: '0x0', ...legacyGasFields(GAS_LIMIT_ROUTER) }
}

