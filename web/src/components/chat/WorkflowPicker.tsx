import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ChatDeployment } from '../../lib/chat-api'
import { POLARCLAW_DIRECT_ID } from '../../lib/chat-api'

interface WorkflowPickerProps {
  deployments: ChatDeployment[]
  value: string
  onChange: (workflowId: string) => void
  className?: string
}

const BUILTIN_POLARCLAW: ChatDeployment = {
  id: POLARCLAW_DIRECT_ID,
  workflow_id: POLARCLAW_DIRECT_ID,
  library: 'WF',
  display_name: 'PolarClaw Agent',
  deployed_at: '',
}

function matchDeployment(d: ChatDeployment, q: string): boolean {
  if (!q.trim()) return true
  const needle = q.trim().toLowerCase()
  return (
    d.display_name.toLowerCase().includes(needle)
    || d.workflow_id.toLowerCase().includes(needle)
    || d.id.toLowerCase().includes(needle)
    || d.library.toLowerCase().includes(needle)
  )
}

export function WorkflowPicker({ deployments, value, onChange, className }: WorkflowPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const allItems = useMemo(() => [BUILTIN_POLARCLAW, ...deployments], [deployments])
  const selected = allItems.find(d => d.id === value)

  const filtered = useMemo(
    () => allItems.filter(d => matchDeployment(d, query)),
    [allItems, query],
  )

  useEffect(() => {
    if (!open) return
    setHighlight(0)
  }, [query, open])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function pick(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      e.preventDefault()
      return
    }
    if (!open) return
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(i => Math.min(i + 1, Math.max(filtered.length - 1, 0)))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && filtered[highlight]) {
      e.preventDefault()
      pick(filtered[highlight].id)
    }
  }

  const label = selected
    ? selected.id === POLARCLAW_DIRECT_ID
      ? selected.display_name
      : `${selected.display_name} (${selected.library})`
    : '选择对话模式…'

  return (
    <div ref={rootRef} className={clsx('relative min-w-[12rem] max-w-md flex-1', className)}>
      <button
        type="button"
        className="w-full flex items-center gap-2 bg-[#2f2f2f] border border-[#565869] rounded-lg px-3 py-1.5 text-sm text-left text-[#ececec] hover:border-[#8e8ea0]"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected && (
          <span className={clsx(
            'shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded',
            selected.id === POLARCLAW_DIRECT_ID
              ? 'bg-[#2a5a3a] text-[#7aefaa]'
              : selected.library === 'LG' ? 'bg-[#4a3a7a] text-[#d4c4ff]' : 'bg-[#1f4a7a] text-[#9ecbff]',
          )}
          >
            {selected.id === POLARCLAW_DIRECT_ID ? 'PC' : selected.library}
          </span>
        )}
        <span className="truncate flex-1">{label}</span>
        <span className="text-[#8e8ea0]">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#2f2f2f] border border-[#565869] rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-[#444654]">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="搜索名称、id、WF / LG…"
              className="w-full bg-[#1a1a1a] border border-[#565869] rounded px-2 py-1.5 text-sm text-[#ececec] placeholder:text-[#6b6b7b] outline-none focus:border-[#8e8ea0]"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-[#8e8ea0]">无匹配项</li>
            )}
            {filtered.map((d, i) => (
              <li key={d.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={d.id === value}
                  className={clsx(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#3f3f3f]',
                    i === highlight && 'bg-[#3f3f3f]',
                    d.id === value && 'text-white',
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(d.id)}
                >
                  <span className={clsx(
                    'shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded',
                    d.id === POLARCLAW_DIRECT_ID
                      ? 'bg-[#2a5a3a] text-[#7aefaa]'
                      : d.library === 'LG' ? 'bg-[#4a3a7a] text-[#d4c4ff]' : 'bg-[#1f4a7a] text-[#9ecbff]',
                  )}
                  >
                    {d.id === POLARCLAW_DIRECT_ID ? 'PC' : d.library}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[#ececec]">{d.display_name}</span>
                    <span className="block truncate text-xs text-[#8e8ea0]">{d.workflow_id}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
