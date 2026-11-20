/**
 * My voice: record or upload a 5–30 s sample that Chatterbox clones.
 *
 * Flow: normalize in the browser → upload to the user's private (`self`)
 * file folder → `setVoice` action validates the clip, records consent and
 * deletes the previous clip. One voice per user; uploading again replaces it.
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth, useQuery, useR2Files } from 'deepspace'
import { Mic, Square, Trash2, Upload } from 'lucide-react'
import { Button, Checkbox, ConfirmModal, Input, Label, useToast } from '@/components/ui'
import { callAction } from '@/lib/actions'
import { CLIP_MAX_SEC, CLIP_MIN_SEC, formatDuration, normalizeClip, type NormalizedClip } from '@/lib/clip'

type Voice = { fileKey: string; label: string; durationSec: number; consentAt: string }

export default function VoicePage() {
  const { userId } = useAuth()
  const { records, status } = useQuery<Voice>('voices')
  const voice = records.find((r) => r.recordId === userId)
  const { upload, getUrl } = useR2Files()
  const { success, error } = useToast()

  const [clip, setClip] = useState<NormalizedClip | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function accept(blob: Blob) {
    try {
      const normalized = await normalizeClip(blob)
      setClip(normalized)
      setPreviewUrl(URL.createObjectURL(normalized.wav))
      if (normalized.trimmed) success('Clip trimmed', `Only the first ${CLIP_MAX_SEC} seconds are used.`)
    } catch (e) {
      error('Clip not usable', e instanceof Error ? e.message : String(e))
    }
  }

  async function startRecording() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      error('Microphone blocked', 'Allow microphone access, or upload a recording instead.')
      return
    }
    const rec = new MediaRecorder(stream)
    const parts: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data)
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      setRecording(false)
      void accept(new Blob(parts, { type: rec.mimeType }))
    }
    recorder.current = rec
    rec.start()
    setRecording(true)
    setElapsed(0)
    const started = Date.now()
    const tick = setInterval(() => {
      const s = (Date.now() - started) / 1000
      setElapsed(s)
      if (s >= CLIP_MAX_SEC || rec.state !== 'recording') {
        clearInterval(tick)
        if (rec.state === 'recording') rec.stop()
      }
    }, 200)
  }

  async function save() {
    if (!clip || !consent) return
    setSaving(true)
    try {
      const up = await upload(clip.wav, `voice-${Date.now()}.wav`)
      if (!up.success || !up.key) throw new Error(up.error ?? 'Upload failed')
      const r = await callAction('setVoice', { fileKey: up.key, label, consent: true })
      if (!r.success) throw new Error(r.error)
      success('Voice saved', 'New episodes will be read in this voice.')
      setClip(null)
      setPreviewUrl(null)
      setConsent(false)
      setLabel('')
    } catch (e) {
      error('Could not save voice', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const r = await callAction('deleteVoice')
    setConfirmDelete(false)
    if (r.success) success('Voice deleted', 'The sample was removed from storage.')
    else error('Could not delete voice', r.error)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-serif text-3xl tracking-tight text-foreground">My voice</h1>
      <p className="mt-2 text-muted-foreground">
        Readaloud clones a voice from a {CLIP_MIN_SEC}–{CLIP_MAX_SEC} second sample. Speak naturally, in a quiet room.
        The sample stays private to your account, and you can replace or delete it at any time.
      </p>

      <section className="mt-8 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]" data-testid="current-voice">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Current voice</h2>
        {status === 'loading' ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : voice ? (
          <div className="mt-3 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium text-foreground">{voice.data.label}</p>
              <p className="text-sm text-muted-foreground">
                {formatDuration(voice.data.durationSec)} · consent recorded {new Date(voice.data.consentAt).toLocaleDateString()}
              </p>
            </div>
            <audio controls src={getUrl(voice.data.fileKey)} className="w-full" />
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete voice
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No voice yet. Add one below to start narrating.</p>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {voice ? 'Replace voice' : 'Add a voice'}
        </h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {recording ? (
            <Button variant="destructive" onClick={() => recorder.current?.stop()}>
              <Square /> Stop · {formatDuration(elapsed)} / {formatDuration(CLIP_MAX_SEC)}
            </Button>
          ) : (
            <Button variant="outline" onClick={startRecording} disabled={saving}>
              <Mic /> Record
            </Button>
          )}
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={recording || saving}>
            <Upload /> Upload audio
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            className="hidden"
            data-testid="voice-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) {
                if (f.size > 25 * 1024 * 1024) error('File too large', 'Use a recording under 25 MB.')
                else void accept(f)
              }
            }}
          />
        </div>
        {recording && (
          <p className="mt-3 text-sm text-muted-foreground">
            Try reading this: “I’m recording a short sample so this app can read articles to me in my own voice. I’ll speak at my
            normal pace, as if I were telling a friend about something I read today.”
          </p>
        )}

        {clip && previewUrl && (
          <div className="mt-5 space-y-4 border-t border-border pt-5">
            <div>
              <p className="text-sm text-muted-foreground">Preview ({formatDuration(clip.durationSec)})</p>
              <audio controls src={previewUrl} className="mt-2 w-full" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="voice-label">Name (optional)</Label>
              <Input id="voice-label" value={label} maxLength={60} placeholder="My voice" onChange={(e) => setLabel(e.target.value)} />
            </div>
            <label className="flex items-start gap-3 rounded-lg bg-muted p-3 text-sm text-foreground" data-testid="consent">
              <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
              <span>
                This is my own voice, or I have the speaker’s explicit permission to clone it. I won’t use it to impersonate
                anyone. Audio produced with it will be marked as AI-generated.
              </span>
            </label>
            <Button onClick={save} disabled={!consent || saving} loading={saving}>
              {voice ? 'Replace voice' : 'Save voice'}
            </Button>
          </div>
        )}
      </section>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete your voice?"
        description="The sample is permanently removed. Existing episodes keep their audio."
        confirmText="Delete"
        variant="destructive"
      />
    </div>
  )
}
