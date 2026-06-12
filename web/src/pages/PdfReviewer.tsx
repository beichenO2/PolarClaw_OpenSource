import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { ReviewItem, Annotation } from '../lib/api'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfReviewerProps {
  item: ReviewItem
  file: File | null
  onBack: () => void
  onUpdate: () => void
}

export function PdfReviewer({ item, file, onBack, onUpdate }: PdfReviewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)

  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.5)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [annotations, setAnnotations] = useState<Annotation[]>(item.annotations)
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [commentText, setCommentText] = useState('')
  const [showCommentFor, setShowCommentFor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 })

  useEffect(() => {
    let cancelled = false
    const loadPdf = async () => {
      setLoading(true)
      setError(null)
      try {
        let src: string | ArrayBuffer
        if (file) {
          src = await file.arrayBuffer()
        } else {
          src = `/api/review/${item.id}/file`
        }
        const doc = await pdfjsLib.getDocument({ data: file ? src as ArrayBuffer : undefined, url: file ? undefined : src as string }).promise
        if (cancelled) return
        pdfDocRef.current = doc
        setNumPages(doc.numPages)
        setCurrentPage(1)
      } catch (err) {
        if (!cancelled) setError(`Failed to load PDF: ${err instanceof Error ? err.message : 'unknown'}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadPdf()
    return () => { cancelled = true }
  }, [item.id, file])

  useEffect(() => {
    const doc = pdfDocRef.current
    if (!doc || !canvasRef.current) return
    let cancelled = false
    const renderPage = async () => {
      const page = await doc.getPage(currentPage)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height
      setCanvasDims({ width: viewport.width, height: viewport.height })
      await page.render({ canvasContext: ctx, viewport }).promise
    }
    renderPage()
    return () => { cancelled = true }
  }, [currentPage, scale, numPages])

  const pageAnnotations = annotations.filter((a) => a.page === currentPage)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!drawing) return
    const rect = overlayRef.current!.getBoundingClientRect()
    setDrawStart({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing || !drawStart) return
    const rect = overlayRef.current!.getBoundingClientRect()
    const x2 = (e.clientX - rect.left) / rect.width
    const y2 = (e.clientY - rect.top) / rect.height
    setCurrentRect({
      x: Math.min(drawStart.x, x2),
      y: Math.min(drawStart.y, y2),
      w: Math.abs(x2 - drawStart.x),
      h: Math.abs(y2 - drawStart.y),
    })
  }

  const handleMouseUp = () => {
    if (!drawing || !currentRect || currentRect.w < 0.005 || currentRect.h < 0.005) {
      setDrawStart(null)
      setCurrentRect(null)
      return
    }
    setShowCommentFor(currentRect)
    setDrawStart(null)
  }

  const saveAnnotation = async () => {
    if (!showCommentFor || !commentText.trim()) return
    const ann: Annotation = {
      id: `ann-${Date.now()}`,
      page: currentPage,
      x: showCommentFor.x,
      y: showCommentFor.y,
      width: showCommentFor.w,
      height: showCommentFor.h,
      comment: commentText.trim(),
      author: 'user',
      created_at: new Date().toISOString(),
    }
    setAnnotations((prev) => [...prev, ann])
    setShowCommentFor(null)
    setCurrentRect(null)
    setCommentText('')
    setDrawing(false)

    if (!item.id.startsWith('local-')) {
      try {
        await api.review.annotate(item.id, {
          page: ann.page, x: ann.x, y: ann.y,
          width: ann.width, height: ann.height,
          comment: ann.comment, author: ann.author,
        })
      } catch { /* offline ok */ }
    }
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    if (selectedAnn === id) setSelectedAnn(null)
  }

  const submitAll = async () => {
    setSaving(true)
    try {
      for (const ann of annotations) {
        await api.review.annotate(item.id, {
          page: ann.page, x: ann.x, y: ann.y,
          width: ann.width, height: ann.height,
          comment: ann.comment, author: ann.author,
        })
      }
      onUpdate()
    } catch { /* ignore */ }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-sm text-mc-accent hover:underline">&larr; Back</button>
        <span className="text-sm font-medium text-mc-text">{item.filename}</span>
        {numPages > 0 && (
          <span className="text-xs text-mc-text-muted">
            Page {currentPage} / {numPages}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
            className="px-2 py-1 text-xs rounded border border-mc-border text-mc-text-muted hover:border-mc-accent"
          >
            -
          </button>
          <span className="text-xs text-mc-text-muted w-12 text-center">{(scale * 100).toFixed(0)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(3, s + 0.25))}
            className="px-2 py-1 text-xs rounded border border-mc-border text-mc-text-muted hover:border-mc-accent"
          >
            +
          </button>
          <button
            onClick={() => setDrawing(!drawing)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium',
              drawing
                ? 'bg-mc-red/20 text-mc-red border-mc-red/30'
                : 'bg-mc-accent/20 text-mc-accent border-mc-accent/30',
            )}
          >
            {drawing ? 'Cancel' : 'Annotate'}
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-16 text-mc-text-muted text-sm">Loading PDF...</div>}
      {error && <div className="text-center py-16 text-mc-red text-sm">{error}</div>}

      {!loading && !error && (
        <div className="flex gap-4">
          <div className="flex-1 overflow-auto" ref={containerRef}>
            <div className="relative inline-block" style={{ width: canvasDims.width || '100%' }}>
              <canvas ref={canvasRef} className="rounded-xl shadow-lg" style={{ display: 'block' }} />

              <div
                ref={overlayRef}
                className="absolute inset-0"
                style={{ cursor: drawing ? 'crosshair' : 'default' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                {pageAnnotations.map((ann) => (
                  <div
                    key={ann.id}
                    className={clsx(
                      'absolute rounded cursor-pointer transition-colors',
                      selectedAnn === ann.id
                        ? 'border-2 border-mc-accent bg-mc-accent/20'
                        : 'border-2 border-mc-orange/60 bg-mc-orange/10 hover:bg-mc-orange/20',
                    )}
                    style={{
                      left: `${ann.x * 100}%`,
                      top: `${ann.y * 100}%`,
                      width: `${ann.width * 100}%`,
                      height: `${ann.height * 100}%`,
                    }}
                    onClick={() => setSelectedAnn(selectedAnn === ann.id ? null : ann.id)}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] bg-mc-orange text-white px-1 rounded whitespace-nowrap max-w-[200px] truncate">
                      {ann.comment}
                    </span>
                  </div>
                ))}

                {currentRect && (
                  <div
                    className="absolute border-2 border-mc-accent border-dashed bg-mc-accent/10 rounded pointer-events-none"
                    style={{
                      left: `${currentRect.x * 100}%`,
                      top: `${currentRect.y * 100}%`,
                      width: `${currentRect.w * 100}%`,
                      height: `${currentRect.h * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="w-72 shrink-0 space-y-3">
            <h3 className="text-sm font-semibold text-mc-accent">
              Annotations ({annotations.length})
            </h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {annotations.map((ann) => (
                <div
                  key={ann.id}
                  className={clsx(
                    'bg-mc-surface border rounded-lg p-3 cursor-pointer transition-colors text-left',
                    selectedAnn === ann.id
                      ? 'border-mc-accent bg-mc-accent/5'
                      : 'border-mc-border hover:border-mc-accent/50',
                  )}
                  onClick={() => {
                    setSelectedAnn(ann.id)
                    setCurrentPage(ann.page)
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-mc-orange font-mono">
                      P{ann.page} ({(ann.x * 100).toFixed(0)}%, {(ann.y * 100).toFixed(0)}%)
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteAnnotation(ann.id) }}
                      className="text-[10px] text-mc-red hover:text-mc-red/80"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="text-xs text-mc-text leading-relaxed">{ann.comment}</p>
                </div>
              ))}
            </div>

            {annotations.length > 0 && !item.id.startsWith('local-') && (
              <button
                onClick={submitAll}
                disabled={saving}
                className="w-full px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium disabled:opacity-50 transition-colors"
              >
                {saving ? 'Submitting...' : 'Submit All to Agent'}
              </button>
            )}
          </div>
        </div>
      )}

      {showCommentFor && (
        <div className="bg-mc-surface border border-mc-border rounded-xl p-4 space-y-3">
          <p className="text-xs text-mc-text-muted">
            Add annotation for region ({(showCommentFor.x * 100).toFixed(0)}%, {(showCommentFor.y * 100).toFixed(0)}%) on page {currentPage}:
          </p>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Describe the modification needed..."
            rows={3}
            className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text resize-y focus:outline-none focus:border-mc-accent"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveAnnotation() }}
          />
          <div className="flex gap-2">
            <button onClick={saveAnnotation} className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium">
              Save (Cmd+Enter)
            </button>
            <button
              onClick={() => { setShowCommentFor(null); setCurrentRect(null); setCommentText('') }}
              className="px-4 py-2 text-sm rounded-lg bg-mc-surface text-mc-text-muted border border-mc-border"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
          >
            &larr; Prev
          </button>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(numPages, 10) }, (_, i) => {
              const pageNum = numPages <= 10 ? i + 1 : Math.max(1, currentPage - 4) + i
              if (pageNum > numPages) return null
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={clsx(
                    'w-7 h-7 text-xs rounded transition-colors',
                    currentPage === pageNum
                      ? 'bg-mc-accent text-white'
                      : 'text-mc-text-muted hover:bg-mc-surface',
                  )}
                >
                  {pageNum}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            disabled={currentPage === numPages}
            className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  )
}
