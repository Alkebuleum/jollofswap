import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeftRight, Droplets, Coins, BadgeDollarSign } from 'lucide-react'

const TOKEN_COLORS: Record<string, string> = {
  ALKE: 'linear-gradient(135deg,#8B5CF6,#a78bfa)',
  MAH:  'linear-gradient(135deg,#F7B53B,#e09c25)',
  JLF:  'linear-gradient(135deg,#FF5A3C,#ff7a4d)',
  USDC: 'linear-gradient(135deg,#2775CA,#4a93e8)',
  USDT: 'linear-gradient(135deg,#26A17B,#3fc497)',
  WAKE: 'linear-gradient(135deg,#8B5CF6,#c4b5fd)',
  cNGN: 'linear-gradient(135deg,#0a7d3c,#10b95a)',
  cGHS: 'linear-gradient(135deg,#C9381F,#FF5A3C)',
  cKES: 'linear-gradient(135deg,#b8161d,#e63946)',
  cZAR: 'linear-gradient(135deg,#0b6b3a,#F7B53B)',
}
const TOKEN_GLYPHS: Record<string, string> = {
  ALKE: 'A', MAH: 'M', JLF: 'J', USDC: '$', USDT: '₮', WAKE: 'W',
  cNGN: '₦', cGHS: '₵', cKES: 'K', cZAR: 'R',
}
function tColor(s: string) { return TOKEN_COLORS[s] || 'linear-gradient(135deg,var(--red),var(--gold))' }
function tGlyph(s: string) { return TOKEN_GLYPHS[s] || s.slice(0, 1).toUpperCase() }

const MARKETS = [
  { a: 'ALKE', b: 'USDC', price: '0.4201', chg:  4.2, vol: '$5.8M', name: 'Alkecoin' },
  { a: 'cNGN', b: 'USDC', price: '0.00065', chg: -0.1, vol: '$4.2M', name: 'Naira stable' },
  { a: 'cGHS', b: 'cNGN', price: '103.07',  chg:  1.8, vol: '$2.9M', name: 'Cedi stable' },
  { a: 'cKES', b: 'USDT', price: '0.00770', chg:  0.4, vol: '$2.1M', name: 'Shilling stable' },
  { a: 'cZAR', b: 'ALKE', price: '0.1309',  chg: -2.3, vol: '$1.7M', name: 'Rand stable' },
  { a: 'ALKE', b: 'cNGN', price: '646.15',  chg:  3.9, vol: '$1.4M', name: 'Alkecoin' },
]

const ECOSYSTEM = [
  { ico: '🪪', name: 'AfPass',   desc: 'Portable digital identity that travels with you across every African market.',     tag: 'Identity →',  to: '#' },
  { ico: '🔐', name: 'Amvault',  desc: 'Self-custodial wallet, connected to JollofSwap in a single tap.',                  tag: 'Wallet →',    to: '#' },
  { ico: '📜', name: 'DRIS',     desc: 'Verify documents and records on-chain — the trust layer beneath every trade.',     tag: 'Records →',   to: '#' },
  { ico: '✦',  name: 'Nuru AI',  desc: 'Route and execute trades in plain language across the whole ecosystem.',           tag: 'Assistant →', to: '#' },
]

const SwapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
    <path d="M12 4v16M12 20l5-5M12 20l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export default function Home() {
  const navigate = useNavigate()

  return (
    <main>
      <div className="jlf-glow" aria-hidden="true" />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="jlf-hero">
        <h1 className="jlf-display">
          Swap value,<br />
          <span className="jlf-grad">without borders.</span>
        </h1>

        {/* Hero swap card — decorative preview, navigates to /swap on interact */}
        <div className="jlf-hero-card">
          {/* Sell leg */}
          <div className="jlf-hero-leg">
            <div className="lab">Sell</div>
            <div className="jlf-hero-leg-row">
              <input
                className="jlf-hero-amt"
                defaultValue="100"
                inputMode="decimal"
                placeholder="0"
                onFocus={() => navigate('/swap')}
                readOnly
              />
              <button className="jlf-hero-tok" onClick={() => navigate('/swap')}>
                <span className="jlf-tcoin" style={{ background: tColor('ALKE'), width: 30, height: 30, fontSize: 13 }}>
                  {tGlyph('ALKE')}
                </span>
                <b>ALKE</b>
                <span className="caret">▾</span>
              </button>
            </div>
            <div className="jlf-hero-usd">$42.00</div>
          </div>

          <div className="jlf-hero-flip">
            <button onClick={() => navigate('/swap')} aria-label="Switch">
              <SwapIcon />
            </button>
          </div>

          {/* Buy leg */}
          <div className="jlf-hero-leg" style={{ marginTop: 6 }}>
            <div className="lab">Buy</div>
            <div className="jlf-hero-leg-row">
              <input
                className="jlf-hero-amt"
                placeholder="0"
                readOnly
                value="64,615"
                onFocus={() => navigate('/swap')}
              />
              <button className="jlf-hero-tok" onClick={() => navigate('/swap')}>
                <span className="jlf-tcoin" style={{ background: tColor('cNGN'), width: 30, height: 30, fontSize: 13 }}>
                  {tGlyph('cNGN')}
                </span>
                <b>cNGN</b>
                <span className="caret">▾</span>
              </button>
            </div>
            <div className="jlf-hero-usd">$42.00</div>
          </div>

          <div className="jlf-hero-rate">
            <span>1 ALKE = 646.15 cNGN</span>
            <span>Slippage <b>0.50%</b></span>
          </div>
          <button className="jlf-hero-btn" onClick={() => navigate('/swap')}>
            Get started
          </button>
          <div className="jlf-hero-route">Routed through JollofSwap V1 · Settled on Alkebuleum</div>
        </div>

        <p className="jlf-subcopy">
          Trade African stablecoins, ALKE, and global assets with{' '}
          <b>zero protocol fees</b> on stablecoin pairs — self-custodial, instant, no middlemen.
        </p>
      </section>

      {/* ── ACTION CARDS ─────────────────────────────────────────── */}
      <div style={{ padding: '40px 0 0' }}>
        <div className="jlf-action-grid">
          <Link className="jlf-action-card" to="/swap?from=USDC&to=ALKE">
            <div className="ico"><BadgeDollarSign size={18} /></div>
            <b>Get ALKE</b>
            <small>Buy ALKE instantly with USD — no crypto experience needed.</small>
          </Link>
          <Link className="jlf-action-card" to="/swap">
            <div className="ico"><ArrowLeftRight size={18} /></div>
            <b>Swap</b>
            <small>Trade across Alkebuleum tokens in a clean, fast UI.</small>
          </Link>
          <Link className="jlf-action-card" to="/liquidity">
            <div className="ico"><Droplets size={18} /></div>
            <b>Liquidity</b>
            <small>Create pools and provide liquidity to earn fees.</small>
          </Link>
          <Link className="jlf-action-card" to="/tokens">
            <div className="ico"><Coins size={18} /></div>
            <b>Tokens</b>
            <small>Create your own token and list it on JollofSwap.</small>
          </Link>
        </div>

        {/* Referral banner */}
        <div className="jlf-referral">
          <div className="jlf-referral-inner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--gold)', flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Referral rewards: earn a share of transaction fees from your referrals — for life.
          </div>
        </div>
      </div>

      {/* ── STATEMENT ────────────────────────────────────────────── */}
      <section className="jlf-statement">
        <h2>
          Africa's exchange.<br />
          <span className="jlf-grad">Built for the continent.</span>
        </h2>
        <p>
          JollofSwap delivers deep liquidity, proven security, and self-custodial trading
          across fifty-five markets — all settled on Alkebuleum, the ledger the continent owns.
        </p>
        <Link className="jlf-ghost" to="/swap">
          Trade without fees&nbsp;
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </section>

      {/* ── STAT STRIP ───────────────────────────────────────────── */}
      <div className="jlf-strip">
        <div className="jlf-strip-grid">
          <div className="jlf-st"><b>$184.6M</b><span>Total value locked</span></div>
          <div className="jlf-st"><b>$23.1M</b><span>24h trading volume</span></div>
          <div className="jlf-st"><b>312</b><span>Active liquidity pools</span></div>
          <div className="jlf-st"><b>55</b><span>Markets across Africa</span></div>
        </div>
      </div>

      {/* ── MARKETS ──────────────────────────────────────────────── */}
      <section className="jlf-section" id="markets">
        <div className="jlf-sh">
          <div className="jlf-ey">Top markets</div>
          <h3>The continent's deepest pools</h3>
          <p>Real liquidity for African currencies, paired against ALKE and global stablecoins.</p>
        </div>
        <div className="jlf-market-table">
          <div className="jlf-trow head">
            <span>Pair</span>
            <span>Price</span>
            <span className="hide-m">24h</span>
            <span className="hide-m">Volume</span>
            <span />
          </div>
          {MARKETS.map((m) => (
            <div className="jlf-trow" key={`${m.a}/${m.b}`}>
              <div className="jlf-tpair">
                <div className="jlf-tpair-coins">
                  <span className="jlf-tcoin" style={{ background: tColor(m.a), width: 30, height: 30, fontSize: 12 }}>{tGlyph(m.a)}</span>
                  <span className="jlf-tcoin" style={{ background: tColor(m.b), width: 30, height: 30, fontSize: 12 }}>{tGlyph(m.b)}</span>
                </div>
                <div className="jlf-pn">
                  {m.a}/{m.b}
                  <small>{m.name}</small>
                </div>
              </div>
              <div className="jlf-tnum">{m.price}</div>
              <div className={m.chg >= 0 ? 'jlf-pos hide-m' : 'jlf-neg hide-m'}>
                {m.chg >= 0 ? '▲' : '▼'} {Math.abs(m.chg)}%
              </div>
              <div className="jlf-tnum hide-m">{m.vol}</div>
              <Link
                className="jlf-tradebtn"
                to={`/swap?from=${m.a}&to=${m.b}`}
                style={{ textDecoration: 'none' }}
              >
                Trade
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── ECOSYSTEM ────────────────────────────────────────────── */}
      <section className="jlf-section" id="eco" style={{ paddingTop: 0 }}>
        <div className="jlf-sh">
          <div className="jlf-ey">Part of Alkebuleum</div>
          <h3>One ecosystem, end to end</h3>
          <p>JollofSwap is the marketplace layer of a sovereign African network.</p>
        </div>
        <div className="jlf-eco-grid">
          {ECOSYSTEM.map((e) => (
            <a key={e.name} className="jlf-ecard" href={e.to}>
              <div className="ico">{e.ico}</div>
              <h4>{e.name}</h4>
              <p>{e.desc}</p>
              <span className="t">{e.tag}</span>
            </a>
          ))}
        </div>
      </section>

    </main>
  )
}
