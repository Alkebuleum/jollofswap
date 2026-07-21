// src/lib/bridge/contracts.ts
//
// Read-only contract state + write-call encoding for the ALKE canonical
// bridge. Uses the real, compiled ABIs (src/abi/*.json) — never hand-written
// fragments — per ALKEBRIDGE.md's ABI-accuracy requirement (events matter for
// progress tracking, not just the write functions).

import { ethers } from 'ethers'
import ALKECanonicalBridgeVaultAbi from '../../abi/ALKECanonicalBridgeVault.json'
import ALKEBnbAbi from '../../abi/ALKEBnb.json'
import {
  ALKEBULEUM_CHAIN_ID,
  ALKEBULEUM_RPC,
  BSC_CHAIN_ID,
  BSC_RPC,
  ALKE_CANONICAL_VAULT_ADDRESS,
  ALKE_BNB_TOKEN_ADDRESS,
} from './config'

export const vaultInterface = new ethers.Interface(ALKECanonicalBridgeVaultAbi)
export const bnbTokenInterface = new ethers.Interface(ALKEBnbAbi)

export function alkebuleumReadProvider() {
  return new ethers.JsonRpcProvider(ALKEBULEUM_RPC, ALKEBULEUM_CHAIN_ID, { staticNetwork: true })
}

export function bscReadProvider() {
  return new ethers.JsonRpcProvider(BSC_RPC, BSC_CHAIN_ID, { staticNetwork: true })
}

export function vaultReader(provider = alkebuleumReadProvider()) {
  return new ethers.Contract(ALKE_CANONICAL_VAULT_ADDRESS, ALKECanonicalBridgeVaultAbi, provider)
}

export function bnbTokenReader(provider = bscReadProvider()) {
  return new ethers.Contract(ALKE_BNB_TOKEN_ADDRESS, ALKEBnbAbi, provider)
}

export type VaultState = {
  paused: boolean
  remainingCapacityRaw: bigint
  totalLockedRaw: bigint
  bridgeCapacityRaw: bigint
  bytecodeExists: boolean
}

export async function readVaultState(provider = alkebuleumReadProvider()): Promise<VaultState> {
  const code = await provider.getCode(ALKE_CANONICAL_VAULT_ADDRESS)
  const bytecodeExists = code !== '0x'
  if (!bytecodeExists) {
    return { paused: true, remainingCapacityRaw: 0n, totalLockedRaw: 0n, bridgeCapacityRaw: 0n, bytecodeExists: false }
  }
  const c = vaultReader(provider)
  const [paused, remainingCapacityRaw, totalLockedRaw, bridgeCapacityRaw] = await Promise.all([
    c.paused(),
    c.remainingCapacity(),
    c.totalLocked(),
    c.bridgeCapacity(),
  ])
  return { paused, remainingCapacityRaw, totalLockedRaw, bridgeCapacityRaw, bytecodeExists: true }
}

export type BnbTokenState = {
  paused: boolean
  capRaw: bigint
  totalSupplyRaw: bigint
  decimals: number
  bytecodeExists: boolean
}

export async function readBnbTokenState(provider = bscReadProvider()): Promise<BnbTokenState> {
  const code = await provider.getCode(ALKE_BNB_TOKEN_ADDRESS)
  const bytecodeExists = code !== '0x'
  if (!bytecodeExists) {
    return { paused: true, capRaw: 0n, totalSupplyRaw: 0n, decimals: 18, bytecodeExists: false }
  }
  const c = bnbTokenReader(provider)
  const [paused, capRaw, totalSupplyRaw, decimals] = await Promise.all([
    c.paused(),
    c.cap(),
    c.totalSupply(),
    c.decimals(),
  ])
  return { paused, capRaw, totalSupplyRaw, decimals: Number(decimals), bytecodeExists: true }
}

export async function readNativeAlkeBalance(address: string, provider = alkebuleumReadProvider()): Promise<bigint> {
  return provider.getBalance(address)
}

export async function readBnbAlkeBalance(address: string, provider = bscReadProvider()): Promise<bigint> {
  const c = bnbTokenReader(provider)
  return c.balanceOf(address)
}

export async function readBnbGasBalance(address: string, provider = bscReadProvider()): Promise<bigint> {
  return provider.getBalance(address)
}

// ── Write-call encoding ──────────────────────────────────────────────────
// Raw {to,data,value,chainId} objects fed into useSignerSession's
// sessionSendTransactions, matching the pattern already used by Swap.tsx.

export function encodeLockForBnb(bnbRecipient: string, amountRaw: bigint) {
  const data = vaultInterface.encodeFunctionData('lockForBnb', [bnbRecipient])
  return {
    to: ALKE_CANONICAL_VAULT_ADDRESS,
    data,
    value: amountRaw,
    chainId: ALKEBULEUM_CHAIN_ID,
  }
}

export function encodeBurnForAlkebuleum(amountRaw: bigint, alkebuleumRecipient: string) {
  const data = bnbTokenInterface.encodeFunctionData('burnForAlkebuleum', [amountRaw, alkebuleumRecipient])
  return {
    to: ALKE_BNB_TOKEN_ADDRESS,
    data,
    value: 0n,
    chainId: BSC_CHAIN_ID,
  }
}

// ── Revert decoding ──────────────────────────────────────────────────────

export function decodeBridgeRevert(errorData: string | undefined | null): string | null {
  if (!errorData) return null
  for (const iface of [vaultInterface, bnbTokenInterface]) {
    try {
      const parsed = iface.parseError(errorData)
      if (parsed) return parsed.name
    } catch {
      // try the other interface
    }
  }
  return null
}
