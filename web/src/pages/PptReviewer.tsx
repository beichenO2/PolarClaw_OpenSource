import { useState } from 'react'
import { clsx } from 'clsx'
import { api } from '../lib/api'
import type { ReviewItem, PptDiff, PptReview } from '../lib/api'

interface PptReviewerProps {
  item: ReviewItem
  onBack: () => void
  onUpdate: () => void
}

export function PptReviewer({ item, onBack, onUpdate }: PptReviewerProps) {
  const pptItem = item as PptReview
  const slides = pptItem.slides ?? []
  const agentDiffs = pptItem.agent_diffs ?? []

  const [currentSlide, setCurrentSlide] = useState(0)
  const [showDiffView, setShowDiffView] = useState(false)
  const [userEdits, setUserEdits] = useState<PptDiff[]>([])
  const [editingDiff, setEditingDiff] = useState<PptDiff | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editComment, setEditComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const slideDiffs = agentDiffs.filter((d) => d.slide_index === currentSlide)
  const slideUserEdits = userEdits.filter((d) => d.slide_index === currentSlide)

  const startEdit = (diff: PptDiff) => {
    setEditingDiff(diff)
    setEditValue(diff.after)
    setEditComment('')
  }

  const saveEdit = () => {
    if (!editingDiff) return
    const edited: PptDiff = {
      ...editingDiff,
      after: editValue,
      change_type: 'modify',
    }
    setUserEdits((prev) => [...prev.filter((d) => !(d.slide_index === edited.slide_index && d.target === edited.target)), edited])
    setEditingDiff(null)
    setEditValue('')
    setEditComment('')
  }

  const submitDiffs = async () => {
    setSubmitting(true)
    try {
      await api.review.submitDiff(item.id, userEdits)
      onUpdate()
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-sm text-mc-accent hover:underline">&larr; Back</button>
        <span className="text-sm font-medium text-mc-text">{item.filename}</span>
        <span className="text-xs text-mc-text-muted">
          Slide {currentSlide + 1} / {Math.max(slides.length, 1)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowDiffView(!showDiffView)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium',
              showDiffView
                ? 'bg-mc-orange/20 text-mc-orange border-mc-orange/30'
                : 'bg-mc-surface text-mc-text-muted border-mc-border hover:border-mc-orange',
            )}
          >
            {showDiffView ? 'Hide Diff' : 'Show Diff'}
          </button>
        </div>
      </div>

      <div className={clsx('grid gap-4', showDiffView ? 'grid-cols-2' : 'grid-cols-1')}>
        <div className="bg-mc-surface border border-mc-border rounded-xl overflow-hidden" style={{ minHeight: 450 }}>
          {slides.length > 0 && slides[currentSlide] ? (
            <img
              src={slides[currentSlide].image_url}
              alt={`Slide ${currentSlide + 1}`}
              className="w-full h-auto"
            />
          ) : (
            <div className="flex items-center justify-center py-24">
              <div className="text-center space-y-2">
                <p className="text-mc-text-muted text-sm">PPT Slide Viewer</p>
                <p className="text-xs text-mc-text-muted">
                  Slides rendered via LibreOffice headless appear here.
                  <br />
                  Agent will provide rendered slide images.
                </p>
              </div>
            </div>
          )}
        </div>

        {showDiffView && (
          <div className="bg-mc-surface border border-mc-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-mc-orange">Agent Changes (Slide {currentSlide + 1})</h3>
            {slideDiffs.length === 0 ? (
              <p className="text-xs text-mc-text-muted">No changes on this slide</p>
            ) : (
              <div className="space-y-3">
                {slideDiffs.map((diff, i) => (
                  <div key={i} className="border border-mc-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        diff.change_type === 'add' ? 'bg-mc-green/20 text-mc-green' :
                        diff.change_type === 'remove' ? 'bg-mc-red/20 text-mc-red' :
                        'bg-mc-yellow/20 text-mc-yellow',
                      )}>
                        {diff.change_type.toUpperCase()}
                      </span>
                      <span className="text-xs text-mc-text-muted font-mono">{diff.target}</span>
                    </div>
                    {diff.change_type !== 'add' && (
                      <div className="text-xs bg-mc-red/5 border border-mc-red/20 rounded px-2 py-1.5 font-mono text-mc-text-muted line-through">
                        {diff.before}
                      </div>
                    )}
                    {diff.change_type !== 'remove' && (
                      <div className="text-xs bg-mc-green/5 border border-mc-green/20 rounded px-2 py-1.5 font-mono text-mc-text">
                        {diff.after}
                      </div>
                    )}
                    <button
                      onClick={() => startEdit(diff)}
                      className="text-[10px] text-mc-accent hover:underline"
                    >
                      Edit this change
                    </button>
                  </div>
                ))}
              </div>
            )}

            {slideUserEdits.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-mc-accent pt-2">Your Edits (Slide {currentSlide + 1})</h3>
                <div className="space-y-2">
                  {slideUserEdits.map((edit, i) => (
                    <div key={i} className="border border-mc-accent/30 rounded-lg p-2 text-xs font-mono">
                      <span className="text-mc-text-muted">{edit.target}: </span>
                      <span className="text-mc-accent">{edit.after}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {editingDiff && (
        <div className="bg-mc-surface border border-mc-accent/30 rounded-xl p-4 space-y-3">
          <p className="text-xs text-mc-text-muted">
            Editing <span className="font-mono text-mc-accent">{editingDiff.target}</span> on slide {editingDiff.slide_index + 1}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-mc-text-muted mb-1">Original</p>
              <div className="bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text-muted font-mono min-h-[60px]">
                {editingDiff.before}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-mc-text-muted mb-1">Your version</p>
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-sm text-mc-text font-mono resize-y min-h-[60px] focus:outline-none focus:border-mc-accent"
                autoFocus
              />
            </div>
          </div>
          <textarea
            value={editComment}
            onChange={(e) => setEditComment(e.target.value)}
            placeholder="Add a comment explaining why (optional)..."
            rows={2}
            className="w-full bg-mc-bg border border-mc-border rounded-lg px-3 py-2 text-xs text-mc-text resize-none focus:outline-none focus:border-mc-accent"
          />
          <div className="flex gap-2">
            <button onClick={saveEdit} className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium">
              Apply Edit
            </button>
            <button onClick={() => setEditingDiff(null)} className="px-4 py-2 text-sm rounded-lg bg-mc-surface text-mc-text-muted border border-mc-border">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))}
          disabled={currentSlide === 0}
          className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
        >
          &larr; Prev
        </button>
        <span className="text-xs text-mc-text-muted">
          Slide {currentSlide + 1} / {Math.max(slides.length, 1)}
        </span>
        <button
          onClick={() => setCurrentSlide(Math.min((slides.length || 1) - 1, currentSlide + 1))}
          disabled={currentSlide >= (slides.length || 1) - 1}
          className="px-3 py-1.5 text-xs rounded-lg border border-mc-border text-mc-text-muted hover:border-mc-accent disabled:opacity-40"
        >
          Next &rarr;
        </button>
      </div>

      {userEdits.length > 0 && (
        <div className="flex items-center justify-between bg-mc-surface border border-mc-accent/30 rounded-xl p-4">
          <div>
            <p className="text-sm text-mc-text font-medium">{userEdits.length} user edit(s) ready</p>
            <p className="text-xs text-mc-text-muted">Submit all edits back to Agent</p>
          </div>
          <button
            onClick={submitDiffs}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-mc-accent/80 text-white hover:bg-mc-accent font-medium disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Edits'}
          </button>
        </div>
      )}
    </div>
  )
}
