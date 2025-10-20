import React, { useMemo, useState, useEffect } from 'react'
import { useAuth } from 'amvault-connect'
import { hexlify, toUtf8Bytes } from 'ethers'

const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || 'Afina Beta'
const NATIVE = import.meta.env.VITE_NATIVE_NAME || 'AKE'

const API_BASE = import.meta.env.VITE_FAUCET_API || '/api';



// utils (top of file or a utils file)
class HttpError extends Error {
  constructor(message, { status, data }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
  }
}

async function postJSON(path, body, { timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!r.ok) {
      const msg = data?.error || data?.message || r.statusText || 'Request failed';
      throw new HttpError(msg, { status: r.status, data });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function friendlyFromHttpError(err, { token }) {
  const status = err?.status
  const msg = String(err?.message || '')
  const raw = err?.data ? JSON.stringify(err.data, null, 2) : undefined

  // Known patterns
  const isEstimateGas = msg.includes('estimateGas') || msg.includes('CALL_EXCEPTION') || msg.includes('revert')
  const isRate = status === 429
  const isWindow = status === 409
  const isBadReq = status === 400

  // Faucet empty / paused / no allowance / not funded
  if (isEstimateGas) {
    if (token === 'RPU') {
      return {
        kind: 'err',
        title: 'RPU faucet unavailable',
        message: 'The faucet cannot dispense RPU right now (likely empty or paused). Please try AKE or try again later.',
        details: raw || msg,
      }
    }
    return {
      kind: 'err',
      title: 'Transaction cannot be sent',
      message: 'The faucet transaction would revert. Please retry later or choose a different token.',
      details: raw || msg,
    }
  }

  if (isWindow) {
    const nextAt = err?.data?.nextAllowedAt
    return {
      kind: 'err',
      title: 'Claim window not reached',
      message: `You already claimed recently.${nextAt ? ` Next claim: ${new Date(nextAt).toLocaleString()}` : ''}`,
      details: raw,
    }
  }

  if (isRate) {
    return {
      kind: 'err',
      title: 'Too many requests',
      message: 'You are hitting the faucet too quickly. Please slow down and try again shortly.',
      details: raw,
    }
  }

  if (isBadReq) {
    return {
      kind: 'err',
      title: 'Invalid request',
      message: msg || 'Some of the inputs are invalid.',
      details: raw,
    }
  }

  return {
    kind: 'err',
    title: 'Unexpected error',
    message: msg || 'Something went wrong. Please try again.',
    details: raw,
  }
}





function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function TabbedHeader({ active = 'faucet', onPick }) {
  const Opt = ({ id, label }) => (
    <button
      className={`seg-opt ${active === id ? 'on' : ''}`}
      onClick={() => onPick(id)}
      aria-pressed={active === id}
    >
      {label}
    </button>
  )
  return (
    <div className="seg">
      <Opt id="faucet" label="Token Faucet" />
      <Opt id="thirdparty" label="Token Swap" />
    </div>
  )
}


function Alert({ kind = 'info', title, message, details }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className={`alert ${kind === 'err' ? 'alert-error' : 'alert-ok'}`}>
      {title ? <div className="alert-title">{title}</div> : null}
      {message ? <div className="alert-msg">{message}</div> : null}
      {details ? (
        <>
          <button className="alert-toggle" onClick={() => setOpen(v => !v)}>
            {open ? 'Hide details' : 'Show details'}
          </button>
          {open && (
            <pre className="alert-details">{details}</pre>
          )}
        </>
      ) : null}
    </div>
  )
}



const PURPOSES = {
  AKE: ['Transaction fees', 'Proposal bond', 'Dev testing'],
  RPU: ['Governance voting', 'Dev testing'],
}

export default function Dashboard() {
  const { session } = useAuth()
  const [tab, setTab] = useState('faucet')
  const [token, setToken] = useState('AKE') // 'AKE' | 'RPU'
  const [purpose, setPurpose] = useState(PURPOSES.AKE[0])
  const [addr, setAddr] = useState(session?.address || '')
  const [claiming, setClaiming] = useState(false)
  const [msg, setMsg] = useState(null)

  // keep purpose coherent with token
  useEffect(() => {
    setPurpose(PURPOSES[token][0])
  }, [token])

  const ready = useMemo(() => addr && /^0x[a-fA-F0-9]{40}$/.test(addr), [addr])



  async function onClaim() {
    setMsg(null);
    setClaiming(true);
    try {
      const res = await postJSON('/faucet/claim', { token, address: addr, purpose });

      // success UI (you already had this)
      const beforeAke = res?.balances?.before?.ake;
      const afterAke = res?.balances?.after?.ake;
      const beforeRpu = res?.balances?.before?.rpu;
      const afterRpu = res?.balances?.after?.rpu;
      const txFrag = res?.txHash ? ` Tx ${String(res.txHash).slice(0, 10)}…` : '';
      let extra = '';
      if (token === 'AKE' && beforeAke != null && afterAke != null) extra = ` (AKE: ${beforeAke} → ${afterAke})`;
      if (token === 'RPU' && beforeRpu != null && afterRpu != null) extra = ` (RPU: ${beforeRpu} → ${afterRpu})`;
      const next = res?.nextAllowedAt ? ` Next claim: ${new Date(res.nextAllowedAt).toLocaleString()}` : '';

      setMsg({ kind: 'ok', text: (res?.message || `Claim submitted.${txFrag}`) + extra + next });

    } catch (e) {
      // Network / timeout
      if (!(e instanceof Error) || e.name === 'AbortError') {
        setMsg({ kind: 'err', title: 'Request timed out', message: 'Please check your connection and try again.' })
        return
      }
      if (e.name === 'TypeError' && String(e.message || '').includes('Failed to fetch')) {
        setMsg({ kind: 'err', title: 'Cannot reach faucet', message: 'API offline or CORS/HTTPS issue.' })
        return
      }

      // Structured HTTP errors -> friendly mapping
      const f = friendlyFromHttpError(e, { token })
      // Optional: append balances if provided
      const b = e?.data?.balances?.before
      if (b && (b.ake || b.rpu)) {
        const parts = []
        if (b.ake) parts.push(`AKE: ${b.ake}`)
        if (b.rpu) parts.push(`RPU: ${b.rpu}`)
        f.message = `${f.message}  Current balance — ${parts.join(', ')}`
      }
      setMsg(f)
    } finally {

      setClaiming(false);
    }
  }







  return (
    <div className="wrap">
      {/* minimalist header */}
      <div className="hero" style={{ paddingBottom: 0 }} />

      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div className="card">
          <TabbedHeader active={tab} onPick={setTab} />

          {/* ------ Card body ------ */}
          {tab === 'faucet' ? (
            <div className="grid g1" style={{ gap: 14 }}>
              <div className="muted" style={{ fontWeight: 700 }}>Select Token & Purpose</div>

              <div className="grid g2">
                <Field label="Token">
                  <select className="select" value={token} onChange={e => setToken(e.target.value)}>
                    <option value="AKE">AKE</option>
                    <option value="RPU">RPU</option>
                  </select>
                </Field>

                <Field label="Intended Use">
                  <select className="select" value={purpose} onChange={e => setPurpose(e.target.value)}>
                    {PURPOSES[token].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Enter Wallet Address">
                <input
                  className="input"
                  placeholder="0x..."
                  value={addr}
                  onChange={e => setAddr(e.target.value.trim())}
                  spellCheck={false}
                />
              </Field>

              <button className="btn" disabled={!ready || claiming} onClick={onClaim}>
                {claiming ? 'Claiming…' : `Claim ${token}`}
              </button>

              {msg && (
                <Alert
                  kind={msg.kind}
                  title={msg.title}
                  message={msg.text || msg.message}
                  details={msg.details}
                />
              )}

            </div>
          ) : (
            // ----- Swap coming soon -----
            <div className="grid g1" style={{ gap: 12 }}>
              <div className="title">Token Swaps — Coming Soon</div>
              <div className="muted">
                Swap AKE, RPU and stable assets directly in JollofSwap. We’re wiring up pools and routing now.
              </div>
              <button className="btn" disabled title="Coming soon">Open Swap</button>
            </div>
          )}
        </div>

        {/* Buy AKE panel — gated */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="title">Buy AKE (Coming Soon)</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Need more than the faucet drip? A purchase flow will let you buy AKE for Afina usage.
            Proceeds will go toward **compensating Afina validators** who secure the network.
          </div>
          <div className="hr" />
          <button className="btn" disabled title="Coming soon">
            Buy AKE
          </button>
        </div>
      </div>
    </div>
  )
}
