import { useEffect, useRef, useState } from 'react'
import { CAPABILITY_OPTIONS, type ChatAgentSettings } from '../../lib/chat-api'

interface Props {
  value: ChatAgentSettings
  onChange: (next: ChatAgentSettings) => void
}

const GROUP_ORDER = ['通用', '推理', 'Agent', '文本'] as const

function ModelSelect({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string | undefined
  onChange: (code: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs text-[#c9d1d9]">{label}</span>
      <span className="block text-[10px] text-[#8e8ea0] mb-1">{hint}</span>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-[#212121] border border-[#565869] rounded-lg px-2 py-1.5 text-sm text-[#ececec] outline-none focus:border-[#8e8ea0]"
      >
        {GROUP_ORDER.map(group => {
          const opts = CAPABILITY_OPTIONS.filter(o => o.group === group)
          if (opts.length === 0) return null
          return (
            <optgroup key={group} label={group}>
              {opts.map(o => (
                <option key={o.code || 'auto'} value={o.code}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </label>
  )
}

export function ChatSettingsPanel({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function patch(p: Partial<ChatAgentSettings>) {
    onChange({ ...value, ...p })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#565869] text-xs text-[#c9d1d9] hover:bg-[#2f2f2f]"
        aria-label="模型与运行设置"
        title="模型与运行设置"
      >
        <span className="text-sm leading-none">⚙</span>
        <span className="hidden sm:inline">模型设置</span>
        <span className="text-[#8e8ea0]">{open ? '▲' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 z-50 bg-[#2f2f2f] border border-[#565869] rounded-xl p-3 shadow-2xl space-y-3">
          <div className="text-xs font-medium text-[#ececec]">运行设置</div>

          <ModelSelect
            label="思考模型"
            hint="首轮推理用；建议选「推理」类"
            value={value.thinkingCapability}
            onChange={code => patch({ thinkingCapability: code })}
          />
          <ModelSelect
            label="工具调用模型"
            hint="工具执行轮用；建议选「Agent」类"
            value={value.toolCapability}
            onChange={code => patch({ toolCapability: code })}
          />

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-[#c9d1d9]">
              RetryLoop 模式
              <span className="block text-[10px] text-[#8e8ea0]">限流/瞬时错误自动退避重试</span>
            </span>
            <input
              type="checkbox"
              checked={!!value.retryLoop}
              onChange={e => patch({ retryLoop: e.target.checked })}
              className="w-4 h-4 accent-[#19c37d]"
            />
          </label>

          <label className="block">
            <span className="text-xs text-[#c9d1d9]">最大循环次数</span>
            <span className="block text-[10px] text-[#8e8ea0] mb-1">工具调用最大轮数（0 = 无限）</span>
            <input
              type="number"
              min={0}
              max={50}
              value={value.maxRounds ?? 15}
              onChange={e => {
                const n = Number(e.target.value)
                patch({ maxRounds: Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 15 })
              }}
              className="w-full bg-[#212121] border border-[#565869] rounded-lg px-2 py-1.5 text-sm text-[#ececec] outline-none focus:border-[#8e8ea0]"
            />
          </label>
        </div>
      )}
    </div>
  )
}
