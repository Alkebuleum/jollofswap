import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { AuthProvider } from 'amvault-connect'
import './index.css'
import AppLayout from './layout/AppLayout'
import Home from './pages/Home'
import P2P from './pages/P2P'
import Swap from './pages/Swap'
import Bridge from './pages/Bridge'
import Liquidity from './pages/Liquidity'
import Farms from './pages/Farms'
import Tokens from './pages/Tokens'
import Wallet from './pages/Wallet'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Support from './pages/Support'
import PrivacyPolicy from './pages/PrivacyPolicy'
import TermsOfService from './pages/TermsOfService'
import { TokenRegistryProvider } from './lib/tokenRegistry'
import { applyTheme } from './lib/prefs'
import AuthGate from './components/AuthGate'

applyTheme()

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'get-alk', element: <Navigate to="/swap?from=USDC&to=MAH" replace /> },
      // Old mock P2P pages (fake merchants) → the real escrow market.
      { path: 'p2p/buy', element: <Navigate to="/p2p" replace /> },
      { path: 'p2p/sell', element: <Navigate to="/p2p" replace /> },
      // Browsing works signed-out; account sections prompt to connect.
      { path: 'p2p', element: <P2P /> },
      { path: 'swap', element: <Swap /> },
      { path: 'bridge', element: <Bridge /> },
      { path: 'liquidity', element: <Liquidity /> },
      { path: 'farms', element: <Farms /> },
      { path: 'tokens', element: <Tokens /> },
      { path: 'wallet', element: <AuthGate><Wallet /></AuthGate> },
      { path: 'profile', element: <AuthGate><Profile /></AuthGate> },
      { path: 'settings', element: <Settings /> },
      { path: 'support', element: <Support /> },
      { path: 'privacy', element: <PrivacyPolicy /> },
      { path: 'terms', element: <TermsOfService /> },
    ],
  },
],
  /*   {
      basename: import.meta.env.BASE_URL, // ✅ makes /jollofswap/ work
    } */
)

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 237422)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider
      config={{
        appName: 'JollofSwap',
        chainId: CHAIN_ID,
        amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
        debug: String(import.meta.env.VITE_AUTH_DEBUG).toLowerCase() === 'true',
      }}
    >
      <TokenRegistryProvider chainId={CHAIN_ID}>
        <RouterProvider router={router} />
      </TokenRegistryProvider>
    </AuthProvider>
  </React.StrictMode>,
)


