import React, { useState, useEffect } from 'react'

const KEY = 'jollofswap.terms.accepted.v3'

export default function TermsGate({ children }) {
  const [ok, setOk] = useState(false)
  useEffect(() => { setOk(localStorage.getItem(KEY) === '1') }, [])

  if (ok) return children

  return (
    <div className="wrap center">
      <div className="card" style={{ maxWidth: 600 }}>
        <div className="title">Before You Continue</div>
        <div className="hr" />
        <p className="muted">
          This faucet provides small test amounts of <b>AKE</b> and <b>RPU</b> tokens on the
          <b> Afina Beta</b> network for development and testing only.
          Tokens have no monetary value, transactions are final, and use is limited to one claim per token every 24 hours.
        </p>
        <div className="hr" />
        <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="checkbox"
            onChange={(e) => {
              if (e.target.checked) localStorage.setItem(KEY, '1')
              else localStorage.removeItem(KEY)
              setOk(e.target.checked)
            }}
          />
          <span>I understand and agree to these terms.</span>
        </label>
      </div>
    </div>
  )
}
