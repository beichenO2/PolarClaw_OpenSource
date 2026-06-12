import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AgentStatus } from '../lib/api'

export function DashboardPage() {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        setStatus(await api.status())
        setError(null)
      } catch {
        setError('Agent 未连接')
      }
    }
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [])

  if (error) {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="w-3 h-3 rounded-full bg-mc-red mx-auto" />
        <p className="text-mc-text-muted">{error}</p>
        <p className="text-xs text-mc-text-muted">确保 PolarClaw 已启动并开启 Web 端口</p>
      </div>
    )
  }

  if (!status) {
    return <p className="text-center text-mc-text-muted py-8">连接中...</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-mc-green shadow-[0_0_8px_#3fb950]" />
        <h2 className="text-lg font-semibold text-mc-text">{status.name}</h2>
        <span className="text-xs text-mc-text-muted">v{status.version}</span>
        <span className="text-xs text-mc-text-muted ml-auto">
          Uptime: {Math.floor(status.uptime / 60)}m
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Channels" value={String(status.channels.length)} color="blue" />
        <StatCard label="Skills" value={String(status.skills.count)} color="purple" />
        <StatCard label="Memory" value={String(status.memory.totalEntries)} color="green" />
        <StatCard label="YOLO Sessions" value={String(status.yolo.activeSessions)} color="orange" />
      </div>

      <div className="bg-mc-surface border border-mc-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-mc-accent mb-3">Channels</h3>
        {status.channels.length > 0 ? (
          <div className="space-y-2">
            {status.channels.map((ch) => (
              <div key={ch.name} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${ch.connected ? 'bg-mc-green' : 'bg-mc-red'}`} />
                <span className="text-sm text-mc-text">{ch.name}</span>
                <span className="text-xs text-mc-text-muted">
                  {ch.connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-mc-text-muted">暂无已连接的通道。通过飞书或 CLI 启动 Agent 后，通道将自动注册。</p>
        )}
      </div>

      <div className="bg-mc-surface border border-mc-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-mc-accent mb-3">Skills ({status.skills.count})</h3>
        {status.skills.names.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {status.skills.names.map((name) => (
              <span key={name} className="text-xs px-2 py-1 rounded-lg bg-mc-bg border border-mc-border text-mc-text-muted">
                {name}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-mc-text-muted">暂无已注册的技能。Skills 在 Agent 启动通道后自动加载。</p>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-mc-accent',
    purple: 'text-mc-purple',
    green: 'text-mc-green',
    orange: 'text-mc-orange',
  }
  return (
    <div className="bg-mc-surface border border-mc-border rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold font-mono ${colorMap[color] ?? 'text-mc-text'}`}>{value}</div>
      <div className="text-xs text-mc-text-muted mt-1">{label}</div>
    </div>
  )
}
