// src/components/MobileTabbar.tsx
import React from 'react'
import { Home, HandCoins, ArrowLeftRight, Droplets, Coins } from 'lucide-react'
import { NavLink } from 'react-router-dom'

export default function MobileTabbar() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200/70 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-slate-800/70 dark:bg-slate-950/80 dark:supports-[backdrop-filter]:bg-slate-950/70">
      <div className="mx-auto max-w-7xl px-2">
        <div className="grid grid-cols-5 h-16">
          <Tab to="/" icon={<Home className="w-5 h-5" />} label="Home" />
          <Tab to="/get-alk" icon={<HandCoins className="w-5 h-5" />} label="Get" />
          <Tab to="/swap" icon={<ArrowLeftRight className="w-5 h-5" />} label="Swap" />
          <Tab to="/liquidity" icon={<Droplets className="w-5 h-5" />} label="LP" />
          <Tab to="/tokens" icon={<Coins className="w-5 h-5" />} label="Tokens" />
        </div>
      </div>
    </nav>
  )
}

function Tab({
  to,
  icon,
  label,
}: {
  to: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'flex flex-col items-center justify-center gap-1',
          'text-[11px] font-medium',
          'transition',
          isActive ? 'text-jlfTomato' : 'text-slate-600 dark:text-slate-400'
        ].join(' ')
      }
    >
      <div
        className={[
          'w-9 h-9 rounded-xl grid place-content-center transition',
          isActiveBgClass(to), // keep TS happy (see below)
        ].join(' ')}
      >
        {icon}
      </div>
      <span className="leading-none">{label}</span>
    </NavLink>
  )
}

// Small trick: we want active bg without redoing icon JSX.
// If you prefer simpler, remove this helper and just style on the parent.
function isActiveBgClass(_to: string) {
  // This gets overridden by the parent NavLink's isActive styling via currentColor.
  // Keep simple: neutral bg always; active still stands out by color.
  return 'bg-transparent'
}
