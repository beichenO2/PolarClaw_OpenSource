import { Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Nav } from './Nav'
import { api } from '../lib/api'

export function Layout() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        await api.status()
        setConnected(true)
      } catch {
        setConnected(false)
      }
    }
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-mc-border flex items-center gap-3">
        <h1 className="text-lg font-semibold text-mc-purple">PolarClaw</h1>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full transition-colors ${
            connected === null ? 'bg-mc-text-muted animate-pulse' :
            connected ? 'bg-mc-green shadow-[0_0_6px_#3fb950]' :
            'bg-mc-red shadow-[0_0_6px_#f85149]'
          }`} />
          <span className="text-[10px] text-mc-text-muted">
            {connected === null ? '连接中' : connected ? 'Agent 在线' : 'Agent 离线'}
          </span>
        </div>
        <div className="ml-auto">
          <Nav />
        </div>
      </header>
      <main className="flex-1 max-w-[1200px] w-full mx-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
