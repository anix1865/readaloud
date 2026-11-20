/**
 * Readaloud end-to-end: the important path plus the security boundaries.
 *
 * Runs against `deepspace dev` with two pool test accounts. The narration
 * test calls the real fal integration once (~300 chars ≈ $0.01).
 */
import path from 'node:path'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test.skip(loadAllTestAccounts().length < 2, 'Needs 2 test accounts (npx deepspace test accounts create …)')
test.describe.configure({ mode: 'serial' })

const VOICE = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'voice-sample.wav')
const ARTICLE =
  'The lighthouse keeper climbed the spiral stairs every evening at dusk. ' +
  'He trimmed the wick, polished the great lens, and watched the beam sweep across the dark water. ' +
  'Ships he would never meet depended on that light, and that was enough for him. ' +
  'In the morning he wrote one line in the logbook and went to sleep.'

/** Call a server action from inside the page, as that page's user. */
async function action(page: Page, name: string, params: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ name, params }) => {
      const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
      const { token } = await t.json()
      const r = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return { status: r.status, body: await r.json() }
    },
    { name, params },
  )
}

async function setVoice(page: Page) {
  await page.goto('/voice')
  await expect(page.getByTestId('current-voice')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('voice-file-input').setInputFiles(VOICE)
  const save = page.getByRole('button', { name: /save voice|replace voice/i }).last()
  await expect(save).toBeDisabled() // consent gate
  await page.getByTestId('consent').click()
  await save.click()
  await expect(page.getByText('Voice saved')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('current-voice').locator('audio')).toBeVisible()
}

test('signed-out visitors cannot use the app', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 15_000 })
  const res = await page.request.post('/api/actions/createEpisode', { data: { text: ARTICLE } })
  expect(res.status()).toBe(401)
})

test('browser cannot reach owner-billed integrations directly', async ({ users }) => {
  const [a] = await users(1)
  await a.page.goto('/home')
  const status = await a.page.evaluate(async () => {
    const t = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const { token } = await t.json()
    const r = await fetch('/api/integrations/fal/run-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model_id: 'fal-ai/flux/dev', input: {} }),
    })
    return r.status
  })
  expect(status).toBe(403)
})

test('voice requires consent and a valid clip', async ({ users }) => {
  const [a] = await users(1)
  await a.page.goto('/home')
  const noConsent = await action(a.page, 'setVoice', { fileKey: 'apps/x/users/y/z.wav' })
  expect(noConsent.body).toMatchObject({ success: false, code: 'consent_required' })
  const foreignKey = await action(a.page, 'setVoice', { fileKey: 'apps/x/users/someone-else/z.wav', consent: true })
  expect(foreignKey.body).toMatchObject({ success: false, code: 'invalid_key' })
})

test('narrate an article in my voice, privately', async ({ users }) => {
  test.setTimeout(6 * 60_000)
  const [alice, bob] = await users(2)

  // Clean slate for repeat runs.
  await alice.page.goto('/home')
  await setVoice(alice.page)

  await alice.page.goto('/home')
  await alice.page.getByRole('tab', { name: /paste or upload text/i }).click()
  const title = `The Lighthouse ${Date.now()}`
  await alice.page.getByLabel('Title').fill(title)
  await alice.page.getByLabel('Article text').fill(ARTICLE)
  await alice.page.getByRole('button', { name: 'Narrate' }).click()

  const row = alice.page.getByTestId('episode-row').filter({ hasText: title }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).not.toHaveAttribute('data-status', 'ready') // a fresh episode, not a leftover
  // Live progress arrives over the record subscription, with no reload.
  await expect(row).toHaveAttribute('data-status', 'ready', { timeout: 5 * 60_000 })

  await row.click()
  const player = alice.page.getByTestId('episode-player')
  await expect(player).toHaveAttribute('data-status', 'ready')
  const src = await player.locator('audio').getAttribute('src')
  expect(src).toBeTruthy()
  // The private file must actually play in the owner's browser.
  const probe = await alice.page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' })
    const audio = document.querySelector<HTMLAudioElement>('[data-testid="episode-player"] audio')!
    if (audio.readyState < 1) await new Promise((res) => audio.addEventListener('loadedmetadata', res, { once: true }))
    return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength, duration: audio.duration }
  }, src!)
  console.log('owner audio probe', probe)
  expect(probe.status).toBe(200)
  expect(probe.size).toBeGreaterThan(10_000)
  expect(probe.duration).toBeGreaterThan(5)
  const episodeId = alice.page.url().split('/episodes/')[1]

  // Bob sees none of it, and cannot touch it through actions either.
  await bob.page.goto('/home')
  await expect(bob.page.getByRole('heading', { name: 'Library' })).toBeVisible({ timeout: 20_000 })
  await expect(bob.page.getByText(title)).toHaveCount(0)
  const steal = await action(bob.page, 'deleteEpisode', { episodeId })
  expect(steal.body).toMatchObject({ success: false, code: 'not_found' })
  const bobStatus = await bob.page.evaluate(async (url) => (await fetch(url, { credentials: 'include' })).status, src!)
  console.log('bob audio status', bobStatus)
  expect(bobStatus).not.toBe(200)

  // Clean up so reruns stay under the daily limit.
  const del = await action(alice.page, 'deleteEpisode', { episodeId })
  expect(del.body).toMatchObject({ success: true })
})

// Opt-in (READALOUD_LONG=1): a real article URL, scraped by firecrawl and
// narrated across several checkpointed job steps, then stitched into one MP3.
// Costs ~$0.25 of fal credits.
test('narrate a real article from a URL across multiple job steps', async ({ users }) => {
  test.skip(!process.env.READALOUD_LONG, 'set READALOUD_LONG=1 to run')
  test.setTimeout(15 * 60_000)
  const [alice] = await users(1)
  await alice.page.goto('/home')
  const started = await action(alice.page, 'createEpisode', { url: 'https://en.wikipedia.org/wiki/Lighthouse_keeper' })
  console.log('createEpisode', started.body)
  expect(started.body.success).toBe(true)
  const { episodeId } = started.body.data

  await alice.page.goto(`/episodes/${episodeId}`)
  const player = alice.page.getByTestId('episode-player')
  await expect(player).toHaveAttribute('data-status', 'generating', { timeout: 60_000 })
  await expect(player).toHaveAttribute('data-status', 'ready', { timeout: 14 * 60_000 })
  const duration = await alice.page.evaluate(async () => {
    const audio = document.querySelector<HTMLAudioElement>('[data-testid="episode-player"] audio')!
    if (audio.readyState < 1) await new Promise((res) => audio.addEventListener('loadedmetadata', res, { once: true }))
    return audio.duration
  })
  console.log('long episode duration (s)', duration)
  expect(duration).toBeGreaterThan(60)
})
