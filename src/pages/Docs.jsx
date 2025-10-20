import React from 'react'
export default function Docs(){
  return (
    <div className="wrap">
      <div className="card">
        <div className="title">Developer Docs</div>
        <div className="hr" />
        <p className="muted">
          Use <code>amvault-connect</code> to integrate AmVault sign-in and transactions.
          Configure <code>VITE_AMVAULT_URL</code> and <code>VITE_CHAIN_ID</code> in your app.
        </p>
        <p className="muted">
          For transaction requests, pass large values as decimal strings and consider providing a manual <code>gas</code> value to bypass estimate errors.
        </p>
      </div>
    </div>
  )
}
