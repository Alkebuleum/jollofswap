import React, { useState } from 'react'
import { sendTransaction } from 'amvault-connect'
import { Interface, parseUnits } from 'ethers'

const DEST = '0x93873f6F68c12E28c0AC50E75C54FC71264fc88B'
const CHAIN = Number(import.meta.env.VITE_CHAIN_ID || 237422)
const DECIMALS = Number(import.meta.env.VITE_AKE_DECIMALS || 18)
const TOKEN = (import.meta.env.VITE_AKE_TOKEN || '').trim()

const GAS_NATIVE = 21000
const GAS_ERC20  = 100000
const MAX_FEE_GWEI = Number(import.meta.env.VITE_MAX_FEE_GWEI || 3)
const MAX_PRIORITY_GWEI = Number(import.meta.env.VITE_MAX_PRIORITY_GWEI || 1)

export default function ValidatorPanel() {
  const [amt, setAmt] = useState(0.01)
  const [txHash, setTxHash] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function doDeposit() {
    try {
      setBusy(true); setErr(''); setTxHash('')
      const valueBase = parseUnits(String(amt || 0), DECIMALS)

      let req
      if (TOKEN) {
        const iface = new Interface(['function transfer(address to, uint256 amount)'])
        const data = iface.encodeFunctionData('transfer', [DEST, valueBase])
        req = { chainId: CHAIN, to: TOKEN, data, value: 0, gas: GAS_ERC20, maxFeePerGasGwei: MAX_FEE_GWEI, maxPriorityFeePerGasGwei: MAX_PRIORITY_GWEI }
      } else {
        req = { chainId: CHAIN, to: DEST, value: valueBase.toString(), gas: GAS_NATIVE, maxFeePerGasGwei: MAX_FEE_GWEI, maxPriorityFeePerGasGwei: MAX_PRIORITY_GWEI }
      }

      const tx = await sendTransaction(req, { app: (import.meta.env.VITE_BRAND_NAME || 'JollofSwap'), amvaultUrl: import.meta.env.VITE_AMVAULT_URL, timeoutMs: 60000 })
      setTxHash(tx)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="title">Validator Outlet</div>
      <div className="muted" style={{ marginTop: 6 }}>
        {TOKEN ? <>Sending <b>ERC-20 AKE</b> via <code>transfer()</code>.</> : <>Sending <b>native AKE</b> to outlet.</>}
      </div>
      <div className="hr" />
      <div className="grid g2">
        <div>
          <label className="label">Deposit (AKE)</label>
          <input className="input" type="number" min="0" step="0.0001" value={amt} onChange={(e)=>setAmt(e.target.value)} />
          <div className="muted" style={{ marginTop: 6 }}>Chain: <b>{CHAIN}</b> • Decimals: <b>{DECIMALS}</b></div>
        </div>
        <div>
          <label className="label">Destination</label>
          <input className="input" readOnly value={DEST} />
          {TOKEN && <div className="muted" style={{ marginTop: 6 }}>Token: <code>{TOKEN}</code></div>}
        </div>
      </div>
      <div className="hr" />
      <button className="btn" onClick={doDeposit} disabled={busy}>{busy ? 'Sending…' : 'Deposit to Outlet'}</button>
      {txHash && <div className="success" style={{ marginTop: 12, wordBreak: 'break-all' }}>Sent! txHash: <b>{txHash}</b></div>}
      {err && <div className="danger" style={{ marginTop: 12, whiteSpace:'pre-wrap' }}>{err}</div>}
    </div>
  )
}
