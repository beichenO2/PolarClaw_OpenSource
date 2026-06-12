import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ChatAnnotation, ChatMessage } from '../../lib/chat-api'

interface Props {
  messages: ChatMessage[]
  pending?: boolean
  onAnnotate?: (messageId: string, annotation: ChatAnnotation) => void
}

/** deepseek 风格的可折叠「思考过程」块：流式时默认展开，完成后默认折叠。 */
function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (streaming && open) endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [text, streaming, open])

  return (
    <div className="mb-2 border-l-2 border-[#565869] pl-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-[#8e8ea0] hover:text-[#c9d1d9]"
      >
        <span>{streaming ? '💭 思考中…' : '💭 已深度思考'}</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[#8e8ea0] mt-1 mb-0 bg-transparent border-none p-0">
          {text}
          <div ref={endRef} />
        </pre>
      )}
    </div>
  )
}

export function MessageList({ messages, pending, onAnnotate }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [popover, setPopover] = useState<{ messageId: string; text: string; x: number; y: number } | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pending])

  function handleMouseUp(messageId: string) {
    if (!onAnnotate) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const text = sel.toString().trim()
    if (text.length < 2) return
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setPopover({ messageId, text, x: rect.left, y: rect.bottom + 4 })
    setNote('')
  }

  function submitAnnotation() {
    if (!popover || !note.trim() || !onAnnotate) return
    onAnnotate(popover.messageId, {
      id: `ann_${Date.now()}`,
      quotedText: popover.text,
      note: note.trim(),
    })
    setPopover(null)
    setNote('')
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 relative">
      {messages.map(m => (
        <div
          key={m.id}
          className={`max-w-3xl mx-auto w-full ${m.role === 'user' ? 'flex justify-end' : ''}`}
        >
          <div
            className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
              m.role === 'user'
                ? 'bg-[#2f2f2f] text-[#ececec] max-w-[85%]'
                : 'bg-transparent text-[#ececec] w-full'
            }`}
            onMouseUp={m.role === 'assistant' ? () => handleMouseUp(m.id) : undefined}
          >
            {m.role === 'assistant' ? (
              <>
                {m.reasoning && m.reasoning.trim() && (
                  <ReasoningBlock text={m.reasoning} streaming={m.id === '__streaming__'} />
                )}
                {m.id === '__streaming__' ? (
                  m.content ? (
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-[#8e8ea0] m-0 bg-transparent border-none p-0">{m.content}</pre>
                  ) : null
                ) : (
                  <div
                    className="markdown-body prose-invert"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(marked.parse(m.content, { async: false }) as string),
                    }}
                  />
                )}
              </>
            ) : (
              <p className="whitespace-pre-wrap">{m.content}</p>
            )}
            {m.annotations && m.annotations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.annotations.map((a, i) => (
                  <span
                    key={a.id}
                    className="text-xs px-2 py-0.5 rounded-full bg-[#1f3d5a]/40 text-[#58a6ff] border border-[#388bfd]/30"
                    title={a.note}
                  >
                    #{i + 1} &quot;{a.quotedText.slice(0, 16)}…&quot;
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
      {pending && !messages.some(m => m.id === '__streaming__') && (
        <div className="max-w-3xl mx-auto text-[#8e8ea0] text-sm animate-pulse">思考中…</div>
      )}
      <div ref={bottomRef} />

      {popover && (
        <div
          className="fixed z-50 w-72 bg-[#2f2f2f] border border-[#565869] rounded-xl p-3 shadow-xl"
          style={{ top: popover.y, left: Math.min(popover.x, window.innerWidth - 300) }}
        >
          <p className="text-xs text-[#8e8ea0] mb-2 line-clamp-2">&quot;{popover.text}&quot;</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="批注… (⌘+Enter 添加)"
            className="w-full bg-[#212121] border border-[#565869] rounded-lg px-3 py-2 text-sm text-[#ececec] resize-none"
            rows={2}
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submitAnnotation()
              }
              if (e.key === 'Escape') setPopover(null)
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="text-xs text-[#8e8ea0] px-2 py-1" onClick={() => setPopover(null)}>
              取消
            </button>
            <button
              type="button"
              className="text-xs bg-[#19c37d] text-white px-3 py-1 rounded-lg disabled:opacity-40"
              disabled={!note.trim()}
              onClick={submitAnnotation}
            >
              添加批注
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
