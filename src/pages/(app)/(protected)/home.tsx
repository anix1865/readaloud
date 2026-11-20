/**
 * Library: start a narration and watch it progress live.
 *
 * Episode rows are written only by the server (createEpisode action and the
 * narrate job). This page subscribes with useQuery, so progress updates
 * arrive over the record WebSocket as the job writes them, with no polling.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { AlertCircle, ChevronRight, Link2, Loader2, Mic, Type } from 'lucide-react'
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, cn, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import { formatDuration } from '@/lib/clip'
import type { Episode } from '@/schemas/episodes-schema'
import { isStale, isWorking } from '@/lib/episodes'
import { LIMITS, approxMinutes } from '@/lib/limits'

const MAX_CHARS = LIMITS.maxChars

export default function LibraryPage() {
  const { userId } = useAuth()
  const voices = useQuery<{ label: string }>('voices')
  const { records, status } = useQuery<Episode>('episodes')
  const voice = voices.records.find((r) => r.recordId === userId)
  const episodes = useMemo(
    () => [...records].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [records],
  )
  const busy = episodes.some((e) => isWorking(e.data.status) && !isStale(e.data.status, e.updatedAt))

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl tracking-tight text-foreground">Library</h1>
      <p className="mt-2 text-muted-foreground">
        Turn an article into audio narrated in your own voice. Up to ~{approxMinutes(LIMITS.maxChars)} minutes per episode,{' '}
        {LIMITS.dailyEpisodes} episodes a day.
      </p>

      {voices.status !== 'loading' && !voice ? (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-xl border border-dashed border-input bg-card p-6" data-testid="no-voice">
          <Mic className="size-5 text-muted-foreground" />
          <p className="text-foreground">First, add a short sample of your voice.</p>
          <Link to="/voice" className="text-sm font-medium text-foreground underline underline-offset-4">
            Set up my voice
          </Link>
        </div>
      ) : (
        <NewEpisode disabled={busy} voiceLabel={voice?.data.label} />
      )}

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Episodes</h2>
        {status === 'loading' ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : episodes.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="episode-list">
            {episodes.map((e) => (
              <li key={e.recordId}>
                <EpisodeRow id={e.recordId} ep={e.data} stale={isStale(e.data.status, e.updatedAt)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function NewEpisode({ disabled, voiceLabel }: { disabled: boolean; voiceLabel?: string }) {
  const { success, error } = useToast()
  const [mode, setMode] = useState<'url' | 'text'>('url')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const params = mode === 'url' ? { url } : { text, title }
    const r = await callAction<{ truncated: boolean }>('createEpisode', params)
    setSubmitting(false)
    if (!r.success) return error('Could not start narration', r.error)
    success('Narration started', r.data.truncated ? `The article was long, so only the first ~${approxMinutes(LIMITS.maxChars)} minutes will be read.` : undefined)
    setUrl('')
    setText('')
    setTitle('')
  }

  async function loadFile(file: File) {
    if (file.size > 200_000) return error('File too large', 'Use a .txt or .md file under 200 KB.')
    const content = await file.text()
    setText(content.slice(0, MAX_CHARS * 2))
    if (!title) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, ''))
  }

  const canSubmit = !disabled && !submitting && (mode === 'url' ? url.trim().length > 0 : text.trim().length >= 200)

  return (
    <form onSubmit={submit} className="mt-8 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" data-testid="new-episode">
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'url' | 'text')}>
        <TabsList>
          <TabsTrigger value="url"><Link2 className="size-4" /> Article link</TabsTrigger>
          <TabsTrigger value="text"><Type className="size-4" /> Paste or upload text</TabsTrigger>
        </TabsList>
        <TabsContent value="url" className="mt-4">
          <Input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Article URL" />
        </TabsContent>
        <TabsContent value="text" className="mt-4 space-y-3">
          <Input placeholder="Title (optional)" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <Textarea rows={8} placeholder="Paste the article text…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Article text" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label className="cursor-pointer underline underline-offset-4">
              Upload .txt / .md
              <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadFile(f) }} />
            </label>
            <span className={cn(text.length > MAX_CHARS && 'text-foreground')}>
              {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters{text.length > MAX_CHARS && ', the rest will be cut'}
            </span>
          </div>
        </TabsContent>
      </Tabs>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Voice: <span className="text-foreground">{voiceLabel ?? '…'}</span> ·{' '}
          <Link to="/voice" className="underline underline-offset-4">change</Link>
        </p>
        <Button type="submit" disabled={!canSubmit} loading={submitting}>
          {disabled ? 'Narration in progress…' : 'Narrate'}
        </Button>
      </div>
    </form>
  )
}

function EpisodeRow({ id, ep, stale }: { id: string; ep: Episode; stale: boolean }) {
  const pct = Math.round((ep.progress ?? 0) * 100)
  const working = isWorking(ep.status) && !stale
  return (
    <Link
      to={`/episodes/${id}`}
      className="group block rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)]"
      data-testid="episode-row"
      data-status={ep.status}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{ep.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {ep.status === 'ready' && <>{formatDuration(ep.durationSec)} · read by {ep.voiceLabel}</>}
            {working && ep.status === 'queued' && 'Waiting to start…'}
            {working && ep.status === 'generating' && <>Narrating · {ep.chunksDone}/{ep.chunksTotal} passages</>}
            {(ep.status === 'failed' || stale) && <span className="inline-flex items-center gap-1 text-destructive"><AlertCircle className="size-3.5" /> Failed</span>}
          </p>
        </div>
        {working ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground" />}
      </div>
      {working && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[var(--color-ring)] transition-[width] duration-700" style={{ width: `${Math.max(3, pct)}%` }} />
        </div>
      )}
    </Link>
  )
}
