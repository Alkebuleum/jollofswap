import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from 'amvault-connect'

export default function Nav() {
  const { session, signout } = useAuth()
  const loc = useLocation()
  const brand = import.meta.env.VITE_BRAND_NAME || 'JollofSwap'
  const tagline = import.meta.env.VITE_TAGLINE || 'AKE Primary Outlet'

  const [open, setOpen] = React.useState(false)
  const isActive = (path) => loc.pathname === path

  // close menu when route changes
  React.useEffect(() => { setOpen(false) }, [loc.pathname])

  return (
    <header className="site-header">
      <div className="wrap nav">
        {/* LEFT: brand */}
        <div className="left">
          <Link to="/" className="brand" aria-label={`${brand} home`}>
            <img src="/logo.svg" width="28" height="30" alt="" />
            <div className="logo">
              <span className="title" style={{ fontSize: 18 }}>{brand}</span>
              <span className="pill">{tagline}</span>
            </div>
          </Link>
        </div>

        {/* RIGHT: desktop actions */}
        <nav className="nav-actions">
          <Link
            to="/compliance"
            className={`pill nav-link ${isActive('/compliance') ? 'active' : ''}`}
            style={{ borderRadius: 8 }}
            aria-current={isActive('/compliance') ? 'page' : undefined}
          >
            Compliance
          </Link>

          {session ? (
            <button className="btn ghost" onClick={signout}>Sign out</button>
          ) : (
            loc.pathname !== '/login' && <Link to="/login" className="btn">Connect</Link>
          )}
        </nav>

        {/* MOBILE: hamburger */}
        <button
          className="burger"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {/* simple icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* MOBILE: dropdown panel */}
      <div className={`mobile-menu ${open ? 'show' : ''}`}>
        <div className="wrap mobile-inner">
          <Link
            to="/compliance"
            className={`pill nav-link ${isActive('/compliance') ? 'active' : ''}`}
            aria-current={isActive('/compliance') ? 'page' : undefined}
          >
            Compliance
          </Link>

          {session ? (
            <button className="btn ghost" onClick={signout} style={{ width: '100%' }}>Sign out</button>
          ) : (
            loc.pathname !== '/login' && <Link to="/login" className="btn" style={{ width: '100%' }}>Connect</Link>
          )}
        </div>
      </div>
    </header>
  )
}
