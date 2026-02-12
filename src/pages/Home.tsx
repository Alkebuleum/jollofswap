// src/pages/Home.tsx
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import LogoJollof from '../assets/logo-jollof.svg'
import { ArrowLeftRight, Droplets, Coins, BadgeDollarSign, ArrowRight } from 'lucide-react'

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-jlfTomato px-5 py-3 text-sm font-semibold text-jlfIvory shadow-sm hover:opacity-95 active:opacity-90'

const btnOutline =
  [
    'inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold',
    'text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 active:bg-slate-100',
    'dark:bg-slate-950/60 dark:text-slate-100 dark:ring-slate-700/70 dark:hover:bg-slate-900/70 dark:active:bg-slate-900',
    'dark:backdrop-blur',
  ].join(' ')

function ActionCard({
  icon,
  title,
  desc,
  to,
}: {
  icon: ReactNode
  title: string
  desc: string
  to: string
}) {
  return (
    <Link
      to={to}
      className={[
        'group rounded-2xl bg-white/85 ring-1 ring-slate-200/80 p-5',
        'shadow-[0_1px_0_rgba(15,23,42,0.04),0_18px_40px_rgba(15,23,42,0.08)]',
        'transition hover:-translate-y-0.5 hover:ring-slate-300/80 hover:bg-white',
        'dark:bg-slate-950/70 dark:ring-slate-800/70 dark:hover:bg-slate-950 dark:hover:ring-slate-700/70',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-10 h-10 rounded-xl bg-jlfIvory/70 ring-1 ring-slate-200 grid place-content-center text-jlfTomato dark:bg-slate-900 dark:ring-slate-700">
            {icon}
          </div>
          <div>
            <div className="font-bold text-slate-900 dark:text-slate-100">{title}</div>
            <div className="mt-1 text-sm text-slate-600 leading-relaxed dark:text-slate-300">{desc}</div>
          </div>
        </div>

        <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 transition mt-2 dark:text-slate-500 dark:group-hover:text-slate-200" />
      </div>
    </Link>
  )
}


export default function Home() {
  return (
    <main className="relative">
      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* LIGHT background */}
        <div className="absolute inset-0 bg-gradient-to-b from-jlfIvory/70 via-white to-jlfIvory/35 dark:hidden" />

        {/* DARK background (ink gradient + depth) */}
        <div className="absolute inset-0 hidden dark:block bg-gradient-to-b from-[#060A12] via-[#070B14] to-[#050814]" />

        {/* Brand glows */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-jlfTomato/10 blur-3xl" />
        <div className="absolute -top-10 right-[-80px] h-64 w-64 rounded-full bg-jlfTomato/8 blur-3xl" />

        {/* Extra DARK glows (orange + cool ink) */}
        <div className="absolute inset-0 hidden dark:block">
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-[520px] w-[520px] rounded-full bg-jlfTomato/12 blur-[90px]" />
          <div className="absolute top-10 left-[-140px] h-[420px] w-[420px] rounded-full bg-sky-500/8 blur-[110px]" />
          <div className="absolute bottom-[-180px] right-[-140px] h-[520px] w-[520px] rounded-full bg-jlfTomato/10 blur-[110px]" />
        </div>

        {/* Subtle dot grid (LIGHT) */}
        <div
          className="absolute inset-0 opacity-[0.045] dark:hidden"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.9) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Subtle dot grid (DARK) */}
        <div
          className="absolute inset-0 hidden dark:block opacity-[0.12]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(226,232,240,0.8) 1px, transparent 0)',
            backgroundSize: '22px 22px',
          }}
        />

        {/* faint diagonal sheen (DARK) */}
        <div className="absolute inset-0 hidden dark:block opacity-[0.18]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(115deg, transparent 0%, rgba(255,255,255,0.06) 18%, transparent 36%, transparent 100%)',
            }}
          />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-12 pb-24">
          <div className="mx-auto max-w-3xl text-center">
            <img src={LogoJollof} alt="JollofSwap" className="mx-auto w-12 h-12" />

            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 ring-1 ring-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-950/60 dark:ring-slate-700/70 dark:text-slate-200 dark:backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-jlfTomato" />
              JollofSwap on Alkebuleum
            </div>

            {/* LIGHT headline stays normal; DARK headline gets premium gradient */}
            <h1 className="mt-5 text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:hidden">
              Africa’s Decentralized Exchange
            </h1>
            <h1 className="mt-5 hidden dark:block text-4xl md:text-6xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-b from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                Africa’s Decentralized Exchange
              </span>
            </h1>

            <p className="mt-4 text-base md:text-lg text-slate-600 leading-relaxed dark:text-slate-300">
              Start by getting{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">ALKE</span> for gas,
              then swap tokens, add liquidity, or create and list your own token.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to="/get-alk" className={btnPrimary}>
                Get ALKE
              </Link>
              <Link to="/swap" className={btnOutline}>
                Enter DEX
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ACTIONS */}
      {/* ACTIONS */}
      <section className="relative mx-auto max-w-7xl px-4 sm:px-6 -mt-14 pb-10">
        <div className="grid md:grid-cols-4 gap-4">
          <ActionCard
            icon={<BadgeDollarSign className="w-5 h-5" />}
            title="Get ALKE"
            desc="Onboard and fund gas so you can use the DEX."
            to="/get-alk"
          />
          <ActionCard
            icon={<ArrowLeftRight className="w-5 h-5" />}
            title="Swap"
            desc="Trade across Alkebuleum tokens in a clean, fast UI."
            to="/swap"
          />
          <ActionCard
            icon={<Droplets className="w-5 h-5" />}
            title="Liquidity"
            desc="Create pools and provide liquidity to earn fees."
            to="/liquidity"
          />
          <ActionCard
            icon={<Coins className="w-5 h-5" />}
            title="Tokens"
            desc="Create your own token and list it on JollofSwap."
            to="/tokens"
          />
        </div>

        {/* Referral callout */}
        <div className="mt-6 rounded-2xl bg-white/85 ring-1 ring-slate-200/80 px-5 py-4 shadow-sm flex items-center justify-center gap-2 text-sm dark:bg-slate-950/70 dark:ring-slate-800/70">
          <BadgeDollarSign className="w-4 h-4 text-jlfTomato" />
          <div className="text-slate-800 font-semibold dark:text-slate-200">
            Referral rewards: earn a share of transaction fees from your referrals — for life.
          </div>
        </div>
      </section>
    </main>
  )
}




