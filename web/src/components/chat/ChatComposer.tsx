import { useEffect, useRef } from 'react'
import type { ChatAnnotation } from '../../lib/chat-api'

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled?: boolean
  pendingAnnotations?: ChatAnnotation[]
  onRemoveAnnotation?: (id: string) => void
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  pendingAnnotations = [],
  onRemoveAnnotation,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  return (
    <div className="border-t border-[#444654] bg-[#212121] px-4 py-4">
      <div className="max-w-3xl mx-auto">
        {pendingAnnotations.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingAnnotations.map((a, i) => (
              <span
                key={a.id}
                className="text-xs px-2 py-1 rounded-lg bg-[#2f2f2f] border border-[#565869] text-[#c9d1d9] flex items-center gap-1"
              >
                #{i + 1} &quot;{a.quotedText.slice(0, 20)}…&quot;
                <button type="button" className="text-[#8e8ea0] hover:text-white" onClick={() => onRemoveAnnotation?.(a.id)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative flex items-end gap-2 rounded-2xl border border-[#565869] bg-[#2f2f2f] px-4 py-3 shadow-lg">
          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="发送消息…（Enter 换行 · Ctrl/⌘+Enter 发送）"
            rows={1}
            disabled={disabled}
            className="flex-1 bg-transparent text-[#ececec] text-[15px] resize-none outline-none max-h-[200px] placeholder:text-[#8e8ea0]"
            onKeyDown={e => {
              // 仅 Ctrl/⌘+Enter 发送；裸 Enter 用于换行。
              // 屏蔽输入法组字阶段（中文输入法打英文按 Enter 上屏时不应误发）。
              const composing = e.nativeEvent.isComposing || e.keyCode === 229
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !composing) {
                e.preventDefault()
                if (!disabled && value.trim()) onSend()
              }
            }}
          />
          <button
            type="button"
            disabled={disabled || !value.trim()}
            onClick={onSend}
            className="shrink-0 w-8 h-8 rounded-lg bg-[#ececec] text-[#212121] disabled:opacity-30 flex items-center justify-center"
            aria-label="发送"
          >
            ↑
          </button>
        </div>
        <p className="text-center text-[11px] text-[#8e8ea0] mt-2">Ctrl/⌘+Enter 发送 · Enter 换行 · 选中助手回复可批注</p>
      </div>
    </div>
  )
}
