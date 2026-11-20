/**
 * Server actions: the only write path for voices and episodes.
 *
 * Actions run with RBAC off (see src/server/action-routes.ts), so every
 * handler here scopes reads and writes to the verified caller (`userId`)
 * itself and never trusts a record id or file key from `params` without
 * checking that it belongs to the caller.
 */

import { appFiles, enqueueJob } from 'deepspace/worker'
import type { ActionHandler, ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { LIMITS, chunkText, markdownToSpeech, parseWav } from '../server/audio'
import type { Episode } from '../schemas/episodes-schema'
import { isStale, isWorking } from '../lib/episodes'

type Voice = {
  fileKey: string
  label: string
  durationSec: number
  sizeBytes: number
  consentAt: string
}

type Rec<T> = { recordId: string; data: T; createdBy?: string; createdAt?: string; updatedAt?: string }

const fail = (error: string, code?: string): ActionResult<never> => ({ success: false, error, code })

async function getOwn<T>(
  tools: Parameters<ActionHandler<Env>>[0]['tools'],
  collection: string,
  recordId: string,
  userId: string,
): Promise<Rec<T> | null> {
  const r = await tools.get(collection, recordId)
  if (!r.success) return null
  const rec = (r.data as { record: Rec<T> }).record
  return rec && rec.createdBy === userId ? rec : null
}

/** The caller's own stored key, never another user's or an app-scope key. */
function isOwnKey(key: unknown, userId: string): key is string {
  return typeof key === 'string' && key.startsWith('apps/') && key.includes(`/users/${userId}/`) && !key.includes('..')
}

/** Reject URLs a scraper should never be pointed at. */
function validateArticleUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(\d+\.){3}\d+$/.test(host) || // raw IPv4
    host.includes(':') // raw IPv6
  ) {
    return null
  }
  return url
}

/** Trim to `max` chars, ending on a sentence boundary when possible. */
function truncateAtSentence(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return { text: end > max * 0.6 ? cut.slice(0, end + 1) : cut, truncated: true }
}

export const actions: Record<string, ActionHandler<Env>> = {
  /**
   * Make an uploaded clip the caller's voice. Requires an explicit consent
   * attestation, validates the clip server-side, and deletes the previous
   * clip so only one voice sample per user is ever stored.
   */
  setVoice: async ({ userId, params, tools, env }) => {
    if (params.consent !== true) {
      return fail('Confirm that this is your voice or that you have the speaker’s permission.', 'consent_required')
    }
    const fileKey = params.fileKey
    if (!isOwnKey(fileKey, userId)) return fail('Invalid voice clip.', 'invalid_key')
    const label = typeof params.label === 'string' ? params.label.trim().slice(0, 60) : ''

    const files = appFiles(env, { scope: 'self', userId })
    let bytes: Uint8Array
    try {
      const res = await files.download(fileKey)
      bytes = new Uint8Array(await res.arrayBuffer())
    } catch {
      return fail('Could not read the uploaded clip.', 'clip_missing')
    }

    const reject = async (msg: string) => {
      await files.delete(fileKey).catch(() => {})
      return fail(msg, 'invalid_clip')
    }
    if (bytes.length > LIMITS.clipMaxBytes) return reject('Clip is too large.')
    let durationSec: number
    try {
      durationSec = parseWav(bytes).durationSec
    } catch {
      return reject('Clip must be a WAV file.')
    }
    if (durationSec < LIMITS.clipMinSec - 0.25 || durationSec > LIMITS.clipMaxSec + 0.5) {
      return reject(`Clip must be ${LIMITS.clipMinSec}–${LIMITS.clipMaxSec} seconds long.`)
    }

    // One voice per user: the record id is the user id.
    const previous = await getOwn<Voice>(tools, 'voices', userId, userId)
    const voice: Voice = {
      fileKey,
      label: label || 'My voice',
      durationSec: Math.round(durationSec * 10) / 10,
      sizeBytes: bytes.length,
      consentAt: new Date().toISOString(),
    }
    const saved = await tools.create('voices', voice, userId)
    if (!saved.success) return saved
    if (previous && previous.data.fileKey !== fileKey) {
      await files.delete(previous.data.fileKey).catch(() => {})
    }
    return { success: true, data: { durationSec: voice.durationSec } }
  },

  /** Delete the caller's voice clip and its record. */
  deleteVoice: async ({ userId, tools, env }) => {
    const voice = await getOwn<Voice>(tools, 'voices', userId, userId)
    if (!voice) return { success: true, data: { deleted: false } }
    await appFiles(env, { scope: 'self', userId }).delete(voice.data.fileKey).catch(() => {})
    const r = await tools.remove('voices', userId)
    if (!r.success) return r
    return { success: true, data: { deleted: true } }
  },

  /**
   * Start a narration: resolve the article text (scrape a URL or take pasted
   * text), enforce limits, create the episode and enqueue the background job.
   */
  createEpisode: async ({ userId, params, tools, env }) => {
    const voice = await getOwn<Voice>(tools, 'voices', userId, userId)
    if (!voice) return fail('Add your voice before creating an episode.', 'no_voice')

    // Rate limits: one running job per user, N episodes per rolling day.
    const mine = await tools.query('episodes', { where: { createdBy: userId }, limit: 200 })
    if (!mine.success) return mine
    const records = (mine.data as unknown as { records: Rec<Episode>[] }).records
    for (const r of records) {
      if (isStale(r.data.status, r.updatedAt ?? r.createdAt)) {
        await tools.update('episodes', r.recordId, { status: 'failed', error: 'Narration was interrupted.' })
        await tools.remove('usage', `usage-${r.recordId}`)
        r.data.status = 'failed'
      }
    }
    if (records.some((r) => isWorking(r.data.status))) {
      return fail('An episode is already being narrated. Wait for it to finish.', 'busy')
    }
    // Quota comes from the append-only usage ledger, not from episodes, so
    // deleting an episode never refunds it. Failed narrations are refunded
    // by the job (it removes their ledger row).
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const inLastDay = (r: Rec<{ kind: string }>) => !!r.createdAt && Date.parse(r.createdAt) > dayAgo
    const usage = await tools.query('usage', { where: { createdBy: userId }, limit: 500 })
    if (!usage.success) return usage
    const mineToday = (usage.data as unknown as { records: Rec<{ kind: string }>[] }).records.filter(inLastDay)
    if (mineToday.filter((r) => r.data.kind === 'narration').length >= LIMITS.dailyEpisodes) {
      return fail(`Daily limit reached (${LIMITS.dailyEpisodes} episodes per 24 hours).`, 'rate_limited')
    }
    // App-wide ceiling, so many accounts can't add up to unbounded spend.
    const all = await tools.query('usage', { where: { kind: 'narration' }, orderBy: 'createdAt', orderDir: 'desc', limit: LIMITS.appDailyEpisodes })
    if (!all.success) return all
    const appToday = (all.data as unknown as { records: Rec<{ kind: string }>[] }).records.filter(inLastDay)
    if (appToday.length >= LIMITS.appDailyEpisodes) {
      return fail('Readaloud has reached its daily narration capacity. Please try again tomorrow.', 'app_capacity')
    }

    let title = typeof params.title === 'string' ? params.title.trim() : ''
    let sourceUrl = ''
    let raw = ''
    if (typeof params.url === 'string' && params.url.trim()) {
      const url = validateArticleUrl(params.url.trim())
      if (!url) return fail('Enter a public http(s) article URL.', 'invalid_url')
      sourceUrl = url.toString()
      // Every scrape is billed, successful or not, so it has its own quota.
      if (mineToday.filter((r) => r.data.kind === 'scrape').length >= LIMITS.dailyScrapes) {
        return fail('Too many article fetches today. Paste the text instead.', 'rate_limited')
      }
      await tools.create('usage', { kind: 'scrape', episodeId: '', chars: 0 })
      const scraped = await tools.integration<{
        data?: { markdown?: string; metadata?: { title?: string; ogTitle?: string } }
      }>('firecrawl/scrape', { url: sourceUrl, formats: ['markdown'], onlyMainContent: true })
      if (!scraped.success) return fail('Could not fetch that article. Try pasting the text instead.', 'scrape_failed')
      const payload = scraped.data as { data?: { markdown?: string; metadata?: { title?: string; ogTitle?: string } } }
      raw = payload.data?.markdown ?? ''
      title ||= payload.data?.metadata?.title ?? payload.data?.metadata?.ogTitle ?? ''
    } else if (typeof params.text === 'string') {
      raw = params.text.slice(0, LIMITS.maxChars * 3)
    } else {
      return fail('Provide an article URL or text.', 'no_input')
    }

    const cleaned = markdownToSpeech(raw)
    if (cleaned.length < LIMITS.minChars) {
      return fail('That article has too little readable text.', 'too_short')
    }
    const { text, truncated } = truncateAtSentence(cleaned, LIMITS.maxChars)
    title = (title || text.split(/[.!?\n]/)[0] || 'Untitled').trim().slice(0, 140)
    const chunksTotal = chunkText(text).length

    const episode: Episode = {
      title,
      sourceUrl,
      text,
      chars: text.length,
      status: 'queued',
      progress: 0,
      chunksDone: 0,
      chunksTotal,
      audioKey: '',
      durationSec: 0,
      error: '',
      voiceLabel: voice.data.label,
    }
    const created = await tools.create('episodes', { ...episode })
    if (!created.success) return created
    const episodeId = created.data.recordId
    const logged = await tools.create('usage', { kind: 'narration', episodeId, chars: text.length }, `usage-${episodeId}`)
    if (!logged.success) {
      await tools.remove('episodes', episodeId)
      return logged
    }

    await enqueueJob(
      env.JOB_ROOMS,
      `app:${env.DEEPSPACE_APP_ID}`,
      'narrate',
      { episodeId, userId },
      { maxAttempts: 1, enqueuedBy: userId },
    )
    return { success: true, data: { episodeId, truncated, chars: text.length } }
  },

  /** Delete an episode and its audio. Refused while it is being generated. */
  deleteEpisode: async ({ userId, params, tools, env }) => {
    const id = params.episodeId
    if (typeof id !== 'string') return fail('Missing episode id.')
    const ep = await getOwn<Episode>(tools, 'episodes', id, userId)
    if (!ep) return fail('Episode not found.', 'not_found')
    if (isWorking(ep.data.status) && !isStale(ep.data.status, ep.updatedAt ?? ep.createdAt)) {
      return fail('Wait for narration to finish before deleting.', 'busy')
    }
    const files = appFiles(env, { scope: 'self', userId })
    const listed = await files.list({ prefix: `episodes/${id}/` }).catch(() => ({ files: [] }))
    await Promise.all(listed.files.map((f) => files.delete(f.key).catch(() => {})))
    const r = await tools.remove('episodes', id)
    if (!r.success) return r
    return { success: true, data: { deleted: true } }
  },
}
