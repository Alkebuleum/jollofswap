import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from 'amvault-connect'
import './index.css'
import AppLayout from './layout/AppLayout'
import Home from './pages/Home'
import P2PBuy from './pages/P2PBuy'
import P2PSell from './pages/P2PSell'
import Swap from './pages/Swap'
import Liquidity from './pages/Liquidity'
import Farms from './pages/Farms'
import Tokens from './pages/Tokens'
import Wallet from './pages/Wallet'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Support from './pages/Support'
import GetALKE from './pages/GetALKE'
import { TokenRegistryProvider } from './lib/tokenRegistry'
import { applyTheme } from './lib/prefs'

applyTheme()

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'get-alk', element: <GetALKE /> },
      { path: 'p2p/buy', element: <P2PBuy /> },
      { path: 'p2p/sell', element: <P2PSell /> },
      { path: 'swap', element: <Swap /> },
      { path: 'liquidity', element: <Liquidity /> },
      { path: 'farms', element: <Farms /> },
      { path: 'tokens', element: <Tokens /> },
      { path: 'wallet', element: <Wallet /> },
      { path: 'profile', element: <Profile /> },
      { path: 'settings', element: <Settings /> },
      { path: 'support', element: <Support /> },
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


