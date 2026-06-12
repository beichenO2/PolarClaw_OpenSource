import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { ReviewItem } from '../lib/api'
import { PdfReviewer } from './PdfReviewer'
import { PptReviewer } from './PptReviewer'

type ReviewTab = 'all' | 'pdf' | 'ppt'

export function ReviewPage() {
  const [tab, setTab] = useState<ReviewTab>('all')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [selected, setSelected] = useState<ReviewItem | null>(null)
  const [localFile, setLocalFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.review.list()
      setItems(data)
    } catch { /* server may not be up yet */ }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [load])

  const filtered = items.filter((i) => tab === 'all' || i.type === tab)

  const handleLocalFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    const type = ext === 'pdf' ? 'pdf' : 'ppt'

    try {
      const result = await api.review.upload(file)
      await load()
      const uploaded = (await api.review.get(result.id)) as ReviewItem
      setSelected(uploaded)
    } catch {
      const mockItem: ReviewItem = {
        id: `local-${Date.now()}`,
        type: type as 'pdf' | 'ppt',
        filename: file.name,
        status: 'pending',
        agent_id: 'local',
        annotations: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setLocalFile(file)
      setSelected(mockItem)
    }
  }

  if (selected) {
    if (selected.type === 'pdf') {
      return <PdfReviewer item={selected} file={localFile} onBack={() => { setSelected(null); setLocalFile(null) }} onUpdate={load} />
    }
    return <PptReviewer item={selected} onBack={() => { setSelected(null); setLocalFile(null) }} onUpdate={load} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(['all', 'pdf', 'ppt'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors',
              tab === t
                ? 'bg-mc-purple/20 text-mc-purple border-mc-purple/30'
                : 'bg-mc-surface text-mc-text-muted border-mc-border hover:border-mc-accent',
            )}
          >
            {t === 'all' ? 'All' : t.toUpperCase()}
          </button>
        ))}

        <label className="ml-auto px-3 py-1.5 text-xs rounded-lg border bg-mc-accent/20 text-mc-accent border-mc-accent/30 cursor-pointer hover:bg-mc-accent/30 transition-colors">
          Open Local File
          <input
            type="file"
            accept=".pdf,.pptx,.ppt"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleLocalFile(e.target.files[0])}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-lg font-medium text-mc-purple">审核产物</p>
          <p className="text-sm text-mc-text-muted max-w-lg mx-auto leading-relaxed">
            Agent 生成的文档（PDF / PPT）会出现在这里。你可以直接在线审核：
            框选 PDF 区域添加修改意见、查看 PPT diff、内联编辑并提交带批注的修改。
          </p>
          <p className="text-xs text-mc-text-muted">也可以用上方 "Open Local File" 打开本地 PDF 试用标注功能。</p>
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto pt-4">
            <div className="bg-mc-surface border border-mc-border rounded-xl p-4 text-left">
              <p className="text-sm font-medium text-mc-accent mb-1">PDF 审核</p>
              <p className="text-xs text-mc-text-muted">框选区域 + 添加修改意见</p>
            </div>
            <div className="bg-mc-surface border border-mc-border rounded-xl p-4 text-left">
              <p className="text-sm font-medium text-mc-orange mb-1">PPT 审核</p>
              <p className="text-xs text-mc-text-muted">查看 diff + 内联修改 + 批注</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item)}
              className="w-full text-left bg-mc-surface border border-mc-border rounded-xl p-4 hover:border-mc-accent transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded-full border font-medium',
                  item.type === 'pdf'
                    ? 'bg-mc-accent/20 text-mc-accent border-mc-accent/30'
                    : 'bg-mc-orange/20 text-mc-orange border-mc-orange/30',
                )}>
                  {item.type.toUpperCase()}
                </span>
                <span className="text-sm text-mc-text font-medium">{item.filename}</span>
                <span className={clsx(
                  'text-xs px-2 py-0.5 rounded-full border font-medium ml-auto',
                  item.status === 'pending' ? 'bg-mc-yellow/20 text-mc-yellow border-mc-yellow/30' :
                  item.status === 'reviewed' ? 'bg-mc-accent/20 text-mc-accent border-mc-accent/30' :
                  'bg-mc-green/20 text-mc-green border-mc-green/30',
                )}>
                  {item.status}
                </span>
              </div>
              {item.annotations.length > 0 && (
                <p className="text-xs text-mc-text-muted mt-2">{item.annotations.length} annotations</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
