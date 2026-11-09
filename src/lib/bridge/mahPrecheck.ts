// src/lib/bridge/mahPrecheck.ts
// Before sending USDC to the Polygon vault: will the bridge be able to mint
// MAH for it? MAH v2 refuses a recipient without a Nuru Account, a frozen one,
// and more than the per-deposit limit, and the vault takes the USDC anyway, so
// such a deposit would wait for a manual refund. Ask the bridge first
// (GET /v1/bridge/mah-precheck, jollofswap-bridge-api) and stop here instead.
//
// Throws a message for the person when the deposit shouldn't go ahead; returns
// { delayed } when it will mint but later (the day's limit is used up).
// While the bridge still mints MAH v1 it answers mode 'v1' and anything goes.

export type MahPrecheck = {
  ok: boolean
  mode: 'v1' | 'v2'
  canDeposit: boolean
  reason?: string | null
  delayed?: boolean
  maxPerDepositUsdc?: string
}

export class MahDepositRefused extends Error {
  constructor(message: string, readonly reason: string) {
    super(message)
  }
}

const usd = (raw: string | undefined) => {
  const n = Number(raw ?? 0) / 1e6
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function refusalMessage(r: MahPrecheck): string {
  switch (r.reason) {
    case 'recipient_not_registered':
      return 'MAH can only go to a Nuru Account. Connect with Nuru (or create a Nuru Account) and try again. Nothing was sent.'
    case 'frozen':
      return 'This account is on hold, so MAH can’t be sent to it. Please contact support. Nothing was sent.'
    case 'above_deposit_limit':
      return `One purchase can be at most $${usd(r.maxPerDepositUsdc)}. Try a smaller amount. Nothing was sent.`
    case 'paused':
      return 'Buying MAH is paused for a moment. Please try again later. Nothing was sent.'
    default:
      return 'The bridge can’t take this deposit right now. Nothing was sent; please try again later.'
  }
}

export async function checkMahDeposit(
  bridgeApi: string,
  recipient: string,
  amountUsdcRaw: bigint,
  fetchImpl: typeof fetch = fetch,
): Promise<{ delayed: boolean }> {
  let r: MahPrecheck
  try {
    const url = `${bridgeApi.replace(/\/$/, '')}/v1/bridge/mah-precheck?recipient=${encodeURIComponent(recipient)}&amountUsdc=${amountUsdcRaw.toString()}`
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
    // An older bridge without this endpoint still mints MAH v1: go ahead.
    if (res.status === 404) return { delayed: false }
    r = (await res.json()) as MahPrecheck
    if (!res.ok || !r?.ok) throw new Error(String((r as any)?.error || res.status))
  } catch {
    throw new MahDepositRefused('Couldn’t check the bridge right now. Nothing was sent; please try again in a minute.', 'precheck_unavailable')
  }
  if (r.mode !== 'v2') return { delayed: false }
  if (!r.canDeposit) throw new MahDepositRefused(refusalMessage(r), String(r.reason || 'refused'))
  return { delayed: !!r.delayed }
}
