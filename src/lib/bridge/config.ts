// src/lib/bridge/config.ts
//
// Single centralized source of truth for ALKE bridge chain IDs, contract
// addresses, RPC/explorer URLs, and operating limits. Do not read
// import.meta.env for any of these values anywhere else — this file is the
// only place that should scatter across chains/contracts (ALKEBRIDGE.md §3).
//
// Architecturally separate from src/lib/jollofAmm.ts (swap/AMM config) —
// the bridge never shares chain config, ABIs, or contract instances with swap.

import { ethers } from 'ethers'

export const ALKEBULEUM_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)
export const ALKEBULEUM_RPC = (import.meta.env.VITE_ALK_RPC as string) || 'https://rpc.alkebuleum.com'
export const ALKEBULEUM_EXPLORER = (import.meta.env.VITE_ALK_EXPLORER as string) || 'https://explorer.alkebuleum.com'

export const BSC_CHAIN_ID = Number(import.meta.env.VITE_BSC_CHAIN_ID ?? 56)
export const BSC_RPC = (import.meta.env.VITE_BSC_RPC as string) || 'https://bsc-dataseed.binance.org'
export const BSC_EXPLORER = (import.meta.env.VITE_BSC_EXPLORER as string) || 'https://bscscan.com'

export const ALKE_CANONICAL_VAULT_ADDRESS =
  (import.meta.env.VITE_ALKE_CANONICAL_VAULT_ALK as string) || '0x28535efBD62551dD4e25Be4E70F5BF9D36D45415'
export const ALKE_BNB_TOKEN_ADDRESS =
  (import.meta.env.VITE_ALKE_BNB_TOKEN as string) || '0x2AA5f4742a87D0A5Dc4053fE29871d82A065584F'

export const ALKE_DECIMALS = 18

// Raw (base-unit) bigint limits — never derive these via floating point.
export const ALKE_BRIDGE_MIN_RAW = BigInt(import.meta.env.VITE_ALKE_BRIDGE_MIN || '1300000000000000000000')
export const ALKE_BRIDGE_MAX_PER_TX_RAW = BigInt(import.meta.env.VITE_ALKE_BRIDGE_MAX_PER_TX || '325000000000000000000000')
export const ALKE_BRIDGE_DAILY_LIMIT_RAW = BigInt(import.meta.env.VITE_ALKE_BRIDGE_DAILY_LIMIT || '1300000000000000000000000')

export const BRIDGE_API = (import.meta.env.VITE_BRIDGE_API as string) || 'https://bridge.jollofswap.com'

// Foundation-only access model — an operational UI restriction, not an
// on-chain allowlist (ALKEBRIDGE.md §2). Each comma-separated entry in
// VITE_ALKE_BRIDGE_ALLOWED_WALLETS is either an EVM address or an AIN
// (Alkebuleum account identifier, e.g. from a Nuru-connected wallet that
// has no stable EOA to allowlist) — entries are sorted into the two lists
// below by whether they parse as a valid address. Addresses are
// checksum-normalized and AINs are uppercased so comparisons never depend
// on case.
function parseAllowedWallets(raw: string | undefined): { addresses: string[]; ains: string[] } {
  const addresses: string[] = []
  const ains: string[] = []
  if (!raw) return { addresses, ains }
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      addresses.push(ethers.getAddress(entry))
    } catch {
      ains.push(entry.toUpperCase())
    }
  }
  return { addresses, ains }
}

const { addresses: ALKE_BRIDGE_ALLOWED_WALLETS, ains: ALKE_BRIDGE_ALLOWED_AINS } = parseAllowedWallets(
  import.meta.env.VITE_ALKE_BRIDGE_ALLOWED_WALLETS as string | undefined
)
export { ALKE_BRIDGE_ALLOWED_WALLETS, ALKE_BRIDGE_ALLOWED_AINS }

export function isAllowedBridgeWallet(address: string | null | undefined): boolean {
  if (!address) return false
  try {
    const normalized = ethers.getAddress(address)
    return ALKE_BRIDGE_ALLOWED_WALLETS.includes(normalized)
  } catch {
    return false
  }
}

export function isAllowedBridgeAin(ain: string | null | undefined): boolean {
  if (!ain) return false
  return ALKE_BRIDGE_ALLOWED_AINS.includes(String(ain).trim().toUpperCase())
}

export type BridgeDirection = 'lock-to-mint' | 'burn-to-release'
