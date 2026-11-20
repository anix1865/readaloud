/**
 * Episode: player, AI disclosure, transcript, download and delete.
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useR2Files } from 'deepspace'
import { ArrowLeft, Download, ExternalLink, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import { formatDuration } from '@/lib/clip'
import type { Episode } from '@/schemas/episodes-schema'
import { isStale, isWorking } from '@/lib/episodes'

export default function EpisodePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { records, status } = useQuery<Episode>('episodes', { where: { recordId: id } })
  const rec = records.find((r) => r.recordId === id)
  const ep = rec?.data
  const { getUrl, downloadFile } = useR2Files()
  const { error } = useToast()
  const [confirm, setConfirm] = useState(false)

  async function remove() {
    const r = await callAction('deleteEpisode', { episodeId: id })
    setConfirm(false)
    if (!r.success) return error('Could not delete', r.error)
    navigate('/home')
  }

  if (status === 'loading') return <p className="p-10 text-center text-muted-foreground">Loading…</p>
  if (!ep) {
    return (
      <div className="p-10 text-center">
        <p className="text-muted-foreground">Episode not found.</p>
        <Link to="/home" className="mt-3 inline-block text-sm underline underline-offset-4">Back to library</Link>
      </div>
    )
  }

  const stale = isStale(ep.status, rec?.updatedAt)
  const working = isWorking(ep.status) && !stale
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/home" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Library
      </Link>
      <h1 className="mt-4 font-serif text-3xl leading-tight tracking-tight text-foreground">{ep.title}</h1>
      {ep.sourceUrl && (
        <a href={ep.sourceUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          {new URL(ep.sourceUrl).hostname} <ExternalLink className="size-3.5" />
        </a>
      )}

      <div className="mt-6 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" data-testid="episode-player" data-status={ep.status}>
        {ep.status === 'ready' && (
          <>
            <audio controls preload="metadata" src={getUrl(ep.audioKey)} className="w-full" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{formatDuration(ep.durationSec)} · read by {ep.voiceLabel}</span>
              <Button variant="ghost" size="sm" onClick={() => downloadFile(ep.audioKey, `${ep.title.slice(0, 60)}.mp3`)}>
                <Download /> MP3
              </Button>
            </div>
          </>
        )}
        {working && (
          <div>
            <p className="text-foreground">{ep.status === 'queued' ? 'Waiting to start…' : `Narrating passage ${ep.chunksDone + 1} of ${ep.chunksTotal}…`}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-[var(--color-ring)] transition-[width] duration-700" style={{ width: `${Math.max(3, Math.round(ep.progress * 100))}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">You can leave this page. Progress is saved and updates live.</p>
          </div>
        )}
        {(ep.status === 'failed' || stale) && (
          <p className="text-destructive">Narration failed: {stale ? 'it was interrupted' : ep.error || 'unknown error'}. Delete it and try again; failed episodes don’t count toward your daily limit.</p>
        )}
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          AI-generated audio. Synthesized with Resemble AI’s Chatterbox, which embeds an inaudible watermark identifying it as synthetic.
        </p>
      </div>

      <details className="mt-6 rounded-xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-medium text-foreground">Transcript ({ep.chars.toLocaleString()} characters)</summary>
        <div className="mt-4 whitespace-pre-line text-[15px] leading-7 text-foreground">{ep.text}</div>
      </details>

      {!working && (
        <Button variant="ghost" size="sm" className="mt-6 text-muted-foreground" onClick={() => setConfirm(true)}>
          <Trash2 /> Delete episode
        </Button>
      )}
      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={remove}
        title="Delete this episode?"
        description="The audio file is permanently removed."
        confirmText="Delete"
      />
    </div>
  )
}
