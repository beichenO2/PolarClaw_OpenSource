import { useCallback, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { YoloSession } from '../lib/api'

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  running: { label: '执行中', color: 'text-blue-400 border-blue-600 bg-blue-600/10' },
  completed: { label: '已完成', color: 'text-green-400 border-green-600 bg-green-600/10' },
  aborted: { label: '已中止', color: 'text-red-400 border-red-600 bg-red-600/10' },
  escalated: { label: '需介入', color: 'text-yellow-400 border-yellow-600 bg-yellow-600/10' },
}

export function YoloPage() {
  const [sessions, setSessions] = useState<YoloSession[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [goal, setGoal] = useState('')
  const [maxSteps, setMaxSteps] = useState(10)
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.yolo.sessions()
      setSessions([...data].reverse())
    } catch { /* server may not be up */ }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 3000)
    return () => clearInterval(iv)
  }, [load])

  const handleStart = async () => {
    if (!goal.trim() || starting) return
    setStarting(true)
    try {
      await api.yolo.start(goal.trim(), maxSteps)
      setGoal('')
      await load()
    } catch { /* ignore */ }
    setStarting(false)
  }

  const handleCancel = async (sessionId: string) => {
    await api.yolo.cancel(sessionId)
    await load()
  }

  const hasRunning = sessions.some(s => s.status === 'running')

  return (
    <div className="space-y-6">
      {/* Start form */}
      <div className="bg-mc-surface border border-mc-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-mc-purple">YOLO 自主执行</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-mc-purple/10 text-mc-purple border border-mc-purple/20">
            Debug &gt; Test &gt; Dev
          </span>
        </div>
        <textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="描述要完成的目标..."
          rows={3}
          className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-3 text-sm text-mc-text resize-y focus:outline-none focus:border-mc-purple transition-[border-color]"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart() }}
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-mc-text-muted">
            最大步数
            <input
              type="number"
              value={maxSteps}
              onChange={e => setMaxSteps(Math.max(1, parseInt(e.target.value) || 10))}
              className="w-16 bg-mc-bg border border-mc-border rounded px-2 py-1 text-xs text-mc-text text-center focus:outline-none focus:border-mc-purple"
            />
          </label>
          <button
            onClick={handleStart}
            disabled={!goal.trim() || starting || hasRunning}
            className="ml-auto px-5 py-2 text-sm rounded-lg bg-mc-purple/80 text-white hover:bg-mc-purple font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {starting ? '启动中...' : hasRunning ? '有会话运行中' : '启动 YOLO'}
          </button>
        </div>
        {hasRunning && (
          <p className="text-[10px] text-mc-text-muted">当前有 YOLO 会话正在运行，请等待完成或取消后再启动新会话。</p>
        )}
      </div>

      {/* Sessions */}
      {sessions.length === 0 ? (
        <div className="text-center py-12 space-y-4">
          <p className="text-lg font-medium text-mc-purple">YOLO 自主执行模式</p>
          <p className="text-sm text-mc-text-muted max-w-lg mx-auto leading-relaxed">
            设定目标后，Agent 将自主执行多步操作直到目标达成。
            每步包含对齐验证、LLM-as-Judge 评估和自动恢复。
          </p>
          <div className="flex justify-center gap-6 pt-4">
            <div className="text-xs space-y-1">
              <p className="text-mc-purple font-medium">对齐验证</p>
              <p className="text-mc-text-muted">启动前确认目标理解</p>
            </div>
            <div className="text-xs space-y-1">
              <p className="text-mc-purple font-medium">自动恢复</p>
              <p className="text-mc-text-muted">失败时自动重试/跳过/升级</p>
            </div>
            <div className="text-xs space-y-1">
              <p className="text-mc-purple font-medium">预算控制</p>
              <p className="text-mc-text-muted">Token + 时间双重限制</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map(session => {
            const style = STATUS_STYLES[session.status] ?? STATUS_STYLES.running!
            const expanded = expandedId === session.sessionId

            return (
              <div key={session.sessionId} className="bg-mc-surface border border-mc-border rounded-xl overflow-hidden">
                {/* Session header */}
                <button
                  className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-mc-bg/50 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : session.sessionId)}
                >
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full border font-medium', style.color)}>
                    {style.label}
                  </span>
                  <span className="text-xs font-mono text-mc-text-muted">{session.sessionId.slice(0, 20)}</span>
                  <div className="ml-auto flex items-center gap-3 text-xs text-mc-text-muted">
                    <span>{session.stepsCompleted} steps</span>
                    <span>{(session.totalTokensUsed / 1000).toFixed(1)}k tokens</span>
                    <span>{(session.elapsedMs / 1000).toFixed(0)}s</span>
                    {session.status === 'running' && (
                      <button
                        onClick={e => { e.stopPropagation(); handleCancel(session.sessionId) }}
                        className="px-2 py-0.5 rounded border border-mc-red/30 text-mc-red hover:bg-mc-red/10 transition-colors"
                      >
                        取消
                      </button>
                    )}
                    <span className="text-mc-text-muted">{expanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Stop reason */}
                {session.stopReason && (
                  <div className="px-5 py-2 border-t border-mc-border bg-mc-bg/30">
                    <p className="text-xs text-mc-text-muted">
                      <span className="text-mc-orange font-medium">终止原因：</span>
                      {session.stopReason}
                    </p>
                  </div>
                )}

                {/* Steps */}
                {expanded && session.steps.length > 0 && (
                  <div className="border-t border-mc-border">
                    {session.steps.map((step, i) => (
                      <div
                        key={i}
                        className={clsx(
                          'px-5 py-3 border-b border-mc-border last:border-b-0',
                          step.goalReached ? 'bg-green-900/5' : step.error ? 'bg-red-900/5' : '',
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-mono text-mc-text-muted bg-mc-bg px-1.5 py-0.5 rounded">
                            Step {step.step}
                          </span>
                          <span className="text-[10px] text-mc-text-muted">
                            {step.tokensUsed} tokens · {(step.durationMs / 1000).toFixed(1)}s
                          </span>
                          {step.goalReached && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-mc-green/10 text-mc-green border border-mc-green/20">
                              目标达成
                            </span>
                          )}
                          {step.error && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-mc-red/10 text-mc-red border border-mc-red/20">
                              错误
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-mc-text leading-relaxed whitespace-pre-wrap line-clamp-6">
                          {step.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
