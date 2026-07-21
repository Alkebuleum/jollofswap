// src/lib/bridge/amount.ts
//
// Bigint-safe ALKE amount parsing/formatting/validation. Never use
// floating-point arithmetic for token amounts (ALKEBRIDGE.md §6).

import { ethers } from 'ethers'
import { ALKE_DECIMALS, ALKE_BRIDGE_MIN_RAW, ALKE_BRIDGE_MAX_PER_TX_RAW, ALKE_BRIDGE_DAILY_LIMIT_RAW } from './config'

export function parseAlkeAmount(input: string): bigint | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const raw = ethers.parseUnits(trimmed, ALKE_DECIMALS)
    return raw < 0n ? null : raw
  } catch {
    return null
  }
}

export function formatAlkeAmount(raw: bigint): string {
  return ethers.formatUnits(raw, ALKE_DECIMALS)
}

export function formatAlkeAmountCommas(raw: bigint): string {
  const formatted = formatAlkeAmount(raw)
  const [whole, frac] = formatted.split('.')
  const wholeWithCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${wholeWithCommas}.${frac}` : wholeWithCommas
}

export type AmountValidationError =
  | 'below_minimum'
  | 'above_max_per_tx'
  | 'daily_limit_reached'
  | 'insufficient_balance'

export const AMOUNT_VALIDATION_MESSAGES: Record<AmountValidationError, string> = {
  below_minimum: `Minimum bridge amount is ${formatAlkeAmountCommas(ALKE_BRIDGE_MIN_RAW)} ALKE.`,
  above_max_per_tx: `Maximum bridge amount is ${formatAlkeAmountCommas(ALKE_BRIDGE_MAX_PER_TX_RAW)} ALKE per transaction.`,
  daily_limit_reached: 'The Foundation daily bridge limit has been reached.',
  insufficient_balance: 'Insufficient ALKE balance.',
}

export function validateAmount(
  amountRaw: bigint,
  opts: { balanceRaw?: bigint; alreadyMovedTodayRaw?: bigint } = {}
): AmountValidationError | null {
  if (amountRaw < ALKE_BRIDGE_MIN_RAW) return 'below_minimum'
  if (amountRaw > ALKE_BRIDGE_MAX_PER_TX_RAW) return 'above_max_per_tx'
  if (opts.balanceRaw != null && amountRaw > opts.balanceRaw) return 'insufficient_balance'
  if (opts.alreadyMovedTodayRaw != null && opts.alreadyMovedTodayRaw + amountRaw > ALKE_BRIDGE_DAILY_LIMIT_RAW) {
    return 'daily_limit_reached'
  }
  return null
}
