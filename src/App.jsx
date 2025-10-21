import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import TermsGate from './components/TermsGate.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Compliance from './pages/Compliance.jsx'
import Footer from './components/Footer.jsx'
import { useAuth } from 'amvault-connect'

function Protected({ children }) {
  const { session, status } = useAuth()
  if (status === 'checking') return null
  if (!session) return <Navigate to="/login" replace />
  return children
}

function ErrorBoundary({ children }) {
  const [err, setErr] = React.useState(null)
  React.useEffect(() => {
    const onError = (e) => setErr(e?.reason || e?.error || e)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onError)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
    }
  }, [])
  if (err) {
    return (
      <div className="wrap">
        <div className="card">
          <div className="title">Something went wrong</div>
          <div className="hr" />
          <pre className="muted" style={{ whiteSpace: 'pre-wrap' }}>{String(err?.message || err)}</pre>
        </div>
      </div>
    )
  }
  return children
}

export default function App() {
  return (
    <div className="page">
      <Nav />

      <main className="content">
        <TermsGate>
          <ErrorBoundary>
            <div className="wrap">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/login" element={<Login />} />
                <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
                <Route path="/compliance" element={<Compliance />} />
              </Routes>
            </div>
          </ErrorBoundary>
        </TermsGate>
      </main>

      <Footer />
    </div>
  )
}
