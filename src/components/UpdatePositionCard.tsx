// src/components/UpdatePositionCard.tsx
// Shown on the Liquidity page when the connected person still has a position
// in an old MAH pool (MAH v1). One button moves it into the new pool; a
// smaller link withdraws it to their wallet instead. Quiet on purpose: no
// banner, no deadline. Renders nothing unless the migration is configured,
// live, and this person has an old position.
import { useCallback, useEffect, useState } from 'react'
import { ethers } from 'ethers'
import {
  buildUpdateTxs,
  buildWithdrawTxs,
  findOldPositions,
  fmtAmount,
  fmtMah,
  migrationConfigured,
  planUpdate,
  type Holder,
  type OldPosition,
  type UpdatePlan,
} from '../lib/mahV2Migration'

type SendResult = { ok?: boolean; txHash?: string; error?: string }

export default function UpdatePositionCard(props: {
  provider: ethers.JsonRpcProvider
  holders: Holder[]
  slippageBps: number
  /** Sends [txs]; skipAaWrap = send from the key itself (its own LP), not through the Nuru Account. */
  send: (txs: any[], skipAaWrap: boolean, step: string) => Promise<SendResult[] | undefined>
  /** Shows "Nuru Account" / "Key Account" next to each position when both can hold LP. */
  showHolder: boolean
  /** Called after a position moved, so the page can refresh its own numbers. */
  onDone?: () => void
}) {
  const { provider, holders, slippageBps, send, showHolder, onDone } = props
  const [positions, setPositions] = useState<OldPosition[]>([])
  const [plans, setPlans] = useState<Record<string, UpdatePlan>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirmWithdraw, setConfirmWithdraw] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const holderKey = holders.map((h) => `${h.kind}:${h.address.toLowerCase()}`).join(',')
  const keyOf = (p: OldPosition) => `${p.pool}:${p.holder.address}`.toLowerCase()

  const load = useCallback(async () => {
    if (!migrationConfigured() || !holders.length) {
      setPositions([])
      return
    }
    try {
      const found = await findOldPositions(provider, holders)
      setPositions(found)
      const next: Record<string, UpdatePlan> = {}
      for (const p of found) next[keyOf(p)] = await planUpdate(provider, p, slippageBps)
      setPlans(next)
    } catch (e) {
      console.warn('[UpdatePosition] could not read old positions', e)
    }
    // holderKey stands in for holders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, holderKey, slippageBps])

  useEffect(() => {
    void load()
  }, [load])

  async function waitAll(hashes: string[]) {
    for (const h of hashes) {
      let r: ethers.TransactionReceipt | null = null
      for (let i = 0; i < 80 && !r; i++) {
        r = await provider.getTransactionReceipt(h)
        if (!r) await new Promise((res) => setTimeout(res, 1500))
      }
      if (!r) throw new Error('The transaction did not confirm in time. Check your activity, then refresh.')
      if (r.status !== 1) throw new Error('The transaction was reverted. Nothing moved; your position is unchanged.')
    }
  }

  async function run(p: OldPosition, mode: 'update' | 'withdraw') {
    const k = keyOf(p)
    setErr(null)
    setMsg(null)
    setBusyKey(k)
    try {
      let txs: any[]
      if (mode === 'update') {
        // Re-plan right before sending, so the minimums match the new pool's price now.
        const plan = await planUpdate(provider, p, slippageBps)
        txs = await buildUpdateTxs(provider, p, plan)
      } else {
        txs = await buildWithdrawTxs(provider, p)
      }
      setMsg('Confirm in your wallet…')
      const results = await send(txs, p.holder.kind === 'key', mode === 'update' ? 'mah_v2_update_position' : 'mah_v2_withdraw_position')
      const fail = results?.find((r) => r?.ok === false)
      if (fail) throw new Error(fail.error || 'Transaction failed')
      const hashes = (results || []).map((r) => r?.txHash).filter(Boolean) as string[]
      setMsg('Waiting for confirmation…')
      await waitAll(hashes)
      setMsg(mode === 'update' ? 'Position updated ✅ It now earns in the new pool.' : 'Withdrawn to your wallet ✅')
      setConfirmWithdraw(null)
      await load()
      onDone?.()
    } catch (e: any) {
      setErr(e?.shortMessage || e?.message || 'Something went wrong.')
      setMsg(null)
    } finally {
      setBusyKey(null)
    }
  }

  if (!positions.length && !msg) return null

  return (
    <div className="jlf-panel" style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
          Pool update
        </div>
      </div>
      {positions.length > 0 && (
        <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16 }}>
          This pool has moved to a new version. Update to keep earning.
        </div>
      )}

      {positions.map((p) => {
        const k = keyOf(p)
        const plan = plans[k]
        const busy = busyKey === k
        const anyBusy = busyKey !== null
        return (
          <div key={k} style={{ padding: '14px 16px', background: 'var(--leg)', border: '1px solid var(--line-2)', borderRadius: 18, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: 'var(--white)' }}>
                {p.otherSymbol} / MAH
              </div>
              {showHolder && (
                <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>{p.holder.kind === 'key' ? 'Key Account' : 'Nuru Account'}</div>
              )}
            </div>
            <div style={{ fontFamily: '"DM Mono"', fontSize: 14.5, color: 'var(--white)', lineHeight: 1.6 }}>
              {fmtAmount(p.otherOut, p.otherDecimals)}&nbsp;<span style={{ color: 'var(--muted)' }}>{p.otherSymbol}</span>
              <br />
              {fmtMah(p.mahOut)}&nbsp;<span style={{ color: 'var(--muted)' }}>MAH</span>
            </div>
            {plan && !plan.tooFar && (plan.refundOther > 0n || plan.refundMah > 0n) && (
              <div style={{ fontSize: 12.5, color: 'var(--muted-2)', marginTop: 8 }}>
                The new pool's price has moved a little: about{' '}
                {plan.refundOther > 0n ? `${fmtAmount(plan.refundOther, p.otherDecimals)} ${p.otherSymbol}` : `${fmtMah(plan.refundMah)} MAH`}{' '}
                won't fit and comes back to your wallet.
              </div>
            )}

            {p.frozen ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14 }}>
                This account is on hold, so the position can't be moved right now. Please contact support.
              </div>
            ) : confirmWithdraw === k ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                  This sends {fmtAmount(p.otherOut, p.otherDecimals)} {p.otherSymbol === 'ALKE' ? 'ALKE (as WAKE)' : p.otherSymbol} and {fmtMah(p.mahOut)} MAH to your wallet.
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="jlf-action" disabled={anyBusy} onClick={() => void run(p, 'withdraw')}>
                    {busy ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                  <button className="jlf-action idle" disabled={anyBusy} onClick={() => setConfirmWithdraw(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : plan?.tooFar ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                  The new pool's price is about {(plan.priceMoveBps / 100).toFixed(1)}% away from your position's, so moving it now
                  would lose part of it. You can withdraw both tokens to your wallet instead, or check back later.
                </div>
                <button className={`jlf-action${anyBusy ? ' idle' : ''}`} disabled={anyBusy} onClick={() => { setErr(null); setMsg(null); setConfirmWithdraw(k) }} style={{ width: '100%' }}>
                  Withdraw instead
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                <button className={`jlf-action${anyBusy ? ' idle' : ''}`} disabled={anyBusy} onClick={() => void run(p, 'update')} style={{ width: '100%' }}>
                  {busy ? 'Updating…' : 'Update position'}
                </button>
                <button
                  disabled={anyBusy}
                  onClick={() => { setErr(null); setMsg(null); setConfirmWithdraw(k) }}
                  style={{ display: 'block', margin: '10px auto 0', background: 'none', border: 0, color: 'var(--muted-2)', fontSize: 12.5, textDecoration: 'underline', cursor: anyBusy ? 'default' : 'pointer' }}
                >
                  Withdraw instead
                </button>
              </div>
            )}
          </div>
        )
      })}

      {msg && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{msg}</div>}
      {err && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{err}</div>}
    </div>
  )
}
