/**
 * Background jobs, run by AppJobRoom (worker.ts).
 *
 * `narrate` turns an episode's text into one MP3 in the owner's cloned voice:
 *
 *   step 1..n   synthesize LIMITS.chunksPerStep chunks in parallel on fal
 *               (Chatterbox HD), encode each WAV to MP3, store it as a part
 *               file, update the episode's progress, then checkpoint with
 *               ctx.continue so each alarm tick stays small (CPU and wall time)
 *   final step  concatenate the parts into audio.mp3, delete the parts and
 *               mark the episode ready
 *
 * Because each step checkpoints the stored part keys, a crash or retry
 * resumes after the last finished batch instead of paying for it again.
 */

import { appFiles } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { createActionTools } from './server/action-routes'
import { LIMITS, bytesToBase64, chunkText, concatBytes, parseWav, wavToMp3 } from './server/audio'
import type { Episode } from './schemas/episodes-schema'

const FAL_MODEL = 'resemble-ai/chatterboxhd/text-to-speech'
const POLL_MS = 2_000
const CHUNK_DEADLINE_MS = 4 * 60_000

interface NarratePayload {
  episodeId: string
  userId: string
}
interface NarrateState {
  next: number
  parts: string[]
  durationSec: number
}

type Tools = ReturnType<typeof createActionTools>

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('canceled'))
    })
  })

/** Unwrap an integration result whether or not the endpoint nests `data`. */
function body<T>(r: { success: boolean; data?: unknown; error?: string }): T {
  if (!r.success) throw new Error(r.error ?? 'Integration call failed')
  const d = r.data as Record<string, unknown>
  return (d && typeof d === 'object' && 'data' in d && Object.keys(d).length === 1 ? d.data : d) as T
}

/** One retry with backoff for transient fal/network failures. */
async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (signal.aborted) throw err
    await sleep(3_000, signal)
    return fn()
  }
}

/** Run one chunk through Chatterbox HD and return its WAV bytes. */
async function synthesize(tools: Tools, text: string, voiceDataUri: string, signal: AbortSignal): Promise<Uint8Array> {
  const started = body<{ jobId?: string; request_id?: string }>(
    await tools.integration('fal/run-model', {
      model_id: FAL_MODEL,
      maxCostUsd: LIMITS.maxCostPerChunkUsd,
      input: { text, audio_url: voiceDataUri, exaggeration: 0.5, cfg: 0.5, temperature: 0.8 },
    }),
  )
  const requestId = started.jobId ?? started.request_id
  if (!requestId) throw new Error('fal did not return a request id')

  const deadline = Date.now() + CHUNK_DEADLINE_MS
  while (Date.now() < deadline) {
    await sleep(POLL_MS, signal)
    const r = body<{ status: string; output?: { audio?: { url?: string } }; error?: unknown }>(
      await tools.integration('fal/get-result', { request_id: requestId }),
    )
    if (r.status === 'COMPLETED') {
      const url = r.output?.audio?.url
      if (!url) throw new Error(`Voice synthesis failed${r.error ? `: ${JSON.stringify(r.error).slice(0, 200)}` : ''}`)
      const audio = await fetch(url, { signal })
      if (!audio.ok) throw new Error(`Could not download synthesized audio (${audio.status})`)
      return new Uint8Array(await audio.arrayBuffer())
    }
    if (r.status === 'FAILED' || r.status === 'ERROR' || r.error) {
      throw new Error(`Voice synthesis failed: ${JSON.stringify(r.error ?? r.status).slice(0, 200)}`)
    }
  }
  throw new Error('Voice synthesis timed out')
}

async function narrate(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  const { episodeId, userId } = job.payload as NarratePayload
  const tools = createActionTools(env, userId, '')
  const files = appFiles(env, { scope: 'self', userId })
  const state: NarrateState = (job.resumeFrom as NarrateState | undefined) ?? { next: 0, parts: [], durationSec: 0 }

  const got = await tools.get('episodes', episodeId)
  if (!got.success) return { skipped: 'episode deleted' }
  const ep = (got.data as unknown as { record: { data: Episode; createdBy: string } }).record
  if (ep.createdBy !== userId) throw new Error('Episode owner mismatch')

  const update = (patch: Partial<Episode>) => tools.update('episodes', episodeId, patch)

  try {
    const chunks = chunkText(ep.data.text)
    if (chunks.length === 0) throw new Error('Nothing to read')

    if (state.next < chunks.length) {
      const vr = await tools.get('voices', userId)
      if (!vr.success) throw new Error('Voice was deleted before narration finished')
      const voiceKey = (vr.data as unknown as { record: { data: { fileKey: string } } }).record.data.fileKey
      const clip = new Uint8Array(await (await files.download(voiceKey)).arrayBuffer())
      // Sent inline as a data URI: the private clip never gets a public URL.
      const voiceDataUri = `data:audio/wav;base64,${bytesToBase64(clip)}`

      if (state.next === 0) await update({ status: 'generating', chunksTotal: chunks.length, error: '' })

      const batch = chunks.slice(state.next, state.next + LIMITS.chunksPerStep)
      const wavs = await Promise.all(batch.map((t) => withRetry(() => synthesize(tools, t, voiceDataUri, ctx.signal), ctx.signal)))
      for (let i = 0; i < wavs.length; i++) {
        const wav = parseWav(wavs[i])
        const mp3 = wavToMp3(wav)
        const idx = state.next + i
        const stored = await files.upload(new Blob([mp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }), {
          key: `episodes/${episodeId}/part-${String(idx).padStart(3, '0')}.mp3`,
        })
        state.parts[idx] = stored.key
        state.durationSec += wav.durationSec
      }
      state.next += batch.length

      const done = state.next
      const progress = done / chunks.length
      await update({ chunksDone: done, progress: Math.min(0.99, progress) })
      ctx.progress(progress, `${done}/${chunks.length} chunks`)
      ctx.continue(state)
      return
    }

    // Final step: stitch the parts. MP3 frames concatenate cleanly.
    const buffers: Uint8Array[] = []
    for (const key of state.parts) {
      buffers.push(new Uint8Array(await (await files.download(key)).arrayBuffer()))
    }
    const final = await files.upload(new Blob([concatBytes(buffers) as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }), {
      key: `episodes/${episodeId}/audio.mp3`,
      name: `${ep.data.title.slice(0, 80)}.mp3`,
    })
    await Promise.all(state.parts.map((k) => files.delete(k).catch(() => {})))
    await update({
      status: 'ready',
      progress: 1,
      audioKey: final.key,
      durationSec: Math.round(state.durationSec),
    })
    return { audioKey: final.key, durationSec: state.durationSec }
  } catch (err) {
    // JobRoom counts every ctx.continue step as an attempt, so job-level
    // retries don't help after the first step; chunks retry in withRetry
    // instead and anything that escapes is final.
    const message = err instanceof Error ? err.message : String(err)
    await update({ status: 'failed', error: message.slice(0, 300) })
    // A failed narration doesn't count toward the daily limit.
    await tools.remove('usage', `usage-${episodeId}`).catch(() => {})
    throw err
  }
}

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  switch (job.type) {
    case 'narrate':
      return narrate(job, ctx, env)
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
