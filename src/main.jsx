import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from 'amvault-connect'
import App from './App.jsx'
import './styles.css'

const BRAND = import.meta.env.VITE_BRAND_NAME || 'JollofSwap'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider
        config={{
          appName: BRAND,
          chainId: Number(import.meta.env.VITE_CHAIN_ID || 237422),
          amvaultUrl: import.meta.env.VITE_AMVAULT_URL,
          debug: String(import.meta.env.VITE_AUTH_DEBUG || '').toLowerCase()==='true',
        }}
      >
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
