import { useEffect, useState } from 'react'
import { Spinner } from '@nextui-org/react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import { createProvider, type DataProvider } from './provider'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [provider, setProvider] = useState<DataProvider | null>(null)

  useEffect(() => {
    const p = createProvider()
    setProvider(p)
    p.isLoggedIn()
      .then(setLoggedIn)
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

  if (!provider) return null

  return loggedIn ? (
    <Dashboard provider={provider} onLogout={() => setLoggedIn(false)} />
  ) : (
    <Login provider={provider} onLogin={() => setLoggedIn(true)} />
  )
}