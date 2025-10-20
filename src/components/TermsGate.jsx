import React, { useState, useEffect } from 'react'

const KEY = 'jollofswap.terms.accepted.v1'

export default function TermsGate({ children }) {
  const [ok, setOk] = useState(false)
  useEffect(() => { setOk(localStorage.getItem(KEY) === '1') }, [])
  if (ok) return children
  return (
    <div className="wrap center">
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="title">Accept terms to continue</div>
        <div className="hr" />
        <p className="muted">
          JollofSwap is an on-chain interface for purchasing and transferring AKE utility tokens.
          No custody. No investment features. On-chain transactions are final and may incur network fees.
        </p>
        <div className="hr" />
        <label style={{ display:'flex', gap:10, alignItems:'center' }}>
          <input type="checkbox" onChange={(e)=>{
            if (e.target.checked) localStorage.setItem(KEY, '1')
            else localStorage.removeItem(KEY)
            setOk(e.target.checked)
          }} />
          <span>I understand and accept the Terms & Disclosures.</span>
        </label>
      </div>
    </div>
  )
}
