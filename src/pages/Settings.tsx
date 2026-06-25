import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  readTheme, writeTheme, applyTheme,
  readSlippageBps, writeSlippageBps,
  readHideBalances, writeHideBalances,
  PREF,
} from '../lib/prefs'

const APP_NAME    = (import.meta.env.VITE_APP_NAME    as string) ?? 'JollofSwap'
const AMVAULT_URL = (import.meta.env.VITE_AMVAULT_URL as string) ?? 'https://amvault.net'
const ALK_CHAIN_ID = Number(import.meta.env.VITE_ALK_CHAIN_ID ?? 237422)
const ALK_RPC     = (import.meta.env.VITE_ALK_RPC     as string) ?? 'https://rpc.alkebuleum.com'
const ALK_EXPLORER = (import.meta.env.VITE_ALK_EXPLORER as string) ?? ''

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      borderRadius: 18, background: 'var(--soft)',
      border: '1px solid var(--line-2)', padding: '20px 20px 16px',
    }}>
      <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 700, fontSize: 15, color: 'var(--white)', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, sub, right }: { label: string; sub?: string; right: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 14px', borderRadius: 12,
      border: '1px solid var(--line)', background: 'var(--surface)',
      marginBottom: 8,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--white)' }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

export default function Settings() {
  const [darkMode,     setDarkMode]     = useState<boolean>(() => readTheme() === 'dark')
  const [slippageBps,  setSlippageBps]  = useState<number>(() => readSlippageBps(50))
  const [hideBalances, setHideBalances] = useState<boolean>(() => readHideBalances())

  useLayoutEffect(() => { writeTheme(darkMode ? 'dark' : 'light'); applyTheme(darkMode ? 'dark' : 'light') }, [darkMode])
  useEffect(() => writeSlippageBps(slippageBps), [slippageBps])
  useEffect(() => writeHideBalances(hideBalances), [hideBalances])

  const slippageOptions = useMemo(() => [30, 50, 100], [])

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 16px 48px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: '"Bricolage Grotesque"', fontWeight: 800, fontSize: 26, color: 'var(--white)', letterSpacing: '-0.5px' }}>
          Settings
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
          Preferences are stored on this device. Wallet security is managed in amVault.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Preferences */}
        <Section title="Preferences">
          <Row
            label="Dark mode"
            sub="UI theme preference"
            right={
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 8 }}>
                <div
                  onClick={() => setDarkMode(v => !v)}
                  style={{
                    width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                    background: darkMode ? 'var(--red)' : 'var(--surface-2)',
                    border: '1px solid var(--line)', position: 'relative', transition: 'background .2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: 3, left: darkMode ? 20 : 3,
                    width: 14, height: 14, borderRadius: '50%', background: 'var(--white)',
                    transition: 'left .2s',
                  }} />
                </div>
              </label>
            }
          />

          <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface)', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--white)' }}>Default slippage</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>Initial slippage on Swap / Liquidity</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>{(slippageBps / 100).toFixed(2)}%</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {slippageOptions.map((bps) => (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: '1px solid var(--line)',
                    background: slippageBps === bps ? 'rgba(247,181,59,.12)' : 'var(--surface-2)',
                    color: slippageBps === bps ? 'var(--gold)' : 'var(--muted)',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: '.15s',
                  }}
                >
                  {(bps / 100).toFixed(2)}%
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              try { Object.values(PREF).forEach((k) => window.localStorage.removeItem(k)) } catch { }
              setDarkMode(false); setSlippageBps(50); setHideBalances(false)
            }}
            style={{
              width: '100%', height: 42, borderRadius: 12,
              border: '1px solid var(--line)', background: 'none',
              color: 'var(--muted)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Reset settings
          </button>
        </Section>

        {/* Security */}
        <Section title="Security">
          <p style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 14 }}>
            JollofSwap never stores your private keys. Security controls (PIN / biometrics / 2FA) are handled in amVault.
          </p>
          <a
            href={AMVAULT_URL}
            target="_blank"
            rel="noreferrer"
            className="jlf-action"
            style={{ display: 'inline-block', textDecoration: 'none', padding: '0 20px', lineHeight: '42px', fontSize: 13.5 }}
          >
            Open amVault
          </a>
        </Section>

        {/* Network */}
        <Section title="Network">
          <Row label="Chain" right={<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--white)' }}>Alkebuleum ({ALK_CHAIN_ID})</span>} />
          <Row label="RPC" right={<span style={{ fontSize: 11, fontFamily: '"DM Mono", monospace', color: 'var(--muted)' }}>{ALK_RPC}</span>} />
          {ALK_EXPLORER && (
            <a
              href={ALK_EXPLORER}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'block', width: '100%', padding: '11px 14px', borderRadius: 12,
                border: '1px solid var(--line)', background: 'none',
                color: 'var(--muted)', fontSize: 13.5, fontWeight: 600,
                textDecoration: 'none', textAlign: 'center', marginBottom: 8,
              }}
            >
              Open Explorer ↗
            </a>
          )}
          <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 4 }}>{APP_NAME} · V1</div>
        </Section>

      </div>
    </div>
  )
}
