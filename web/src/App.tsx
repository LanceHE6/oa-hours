import { useEffect, useState } from 'react'
import { Spinner } from '@nextui-org/react'
import { apiGet, type AuthResponse } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    apiGet<AuthResponse>('/api/auth')
      .then((a) => setLoggedIn(a.loggedIn))
      .catch(() => setLoggedIn(false))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="加载中…" color="primary" />
      </div>
    )
  }

  return loggedIn ? <Dashboard onLogout={() => setLoggedIn(false)} /> : <Login onLogin={() => setLoggedIn(true)} />
}
