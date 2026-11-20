# Readaloud

**Live:** https://readaloud.app.space

Paste an article link (or text), record a 5–30 second sample of your voice, and Readaloud returns the article as an MP3 narrated in that voice. Uploading a new clip replaces the voice.

Built on [DeepSpace](https://docs.deep.space) (Cloudflare Workers + Durable Objects).

## How it works

```
Browser                         Worker (server actions)                 AppJobRoom (background job)
───────                         ───────────────────────                 ───────────────────────────
record/upload clip
 → normalize to 24 kHz WAV
 → upload to private R2 folder
 → setVoice ───────────────────▶ validate WAV + duration,
                                 record consent, delete old clip
paste URL / text
 → createEpisode ──────────────▶ quotas, firecrawl/scrape,
                                 clean + chunk text,
                                 create episode, enqueue job ─────────▶ per step: 4 chunks → fal Chatterbox HD
                                                                         (clip sent as data URI) → WAV → MP3
episode list ◀── live record updates (WebSocket) ◀──────────────────────  part files; update progress;
                                                                         ctx.continue(checkpoint)
                                                                         final: stitch parts → audio.mp3
<audio src=private file> (owner session only)
```

| Piece | Where |
|---|---|
| Schemas (`voices`, `episodes`, `usage`) | `src/schemas/` |
| Server actions (only write path) | `src/actions/index.ts` |
| Narration job | `src/jobs.ts` |
| Text/WAV/MP3 helpers (unit-tested) | `src/server/audio.ts` |
| Limits + cost model | `src/lib/limits.ts` |
| Proxy hardening | `src/server/http-routes.ts`, `worker.ts` |
| Pages | `src/pages/(app)/(protected)/` |

## DeepSpace primitives and integrations used

- **Auth**: GitHub/Google sign-in. Every app page sits under `(protected)`, and every action checks the JWT.
- **Records** with RBAC: all three collections are `read: 'own'` and not writable from the browser. Server actions are the only writers, and each one checks ownership itself (actions run RBAC-off).
- **Real-time record subscriptions**: narration progress streams to the page with no polling.
- **Files (R2, `self` scope)**: voice clips and episode audio are private. The `<audio>` element plays them through the owner's session, and another signed-in user gets 403.
- **Background jobs (`JobRoom`)** with `ctx.continue` checkpoints, so each step stays well inside Worker CPU and wall-time limits, and a retry resumes after the last finished batch.
- **Integrations**: `fal/run-model` + `fal/get-result` (Resemble AI **Chatterbox HD**: zero-shot voice cloning with a built-in perceptual watermark) and `firecrawl/scrape` (article → clean markdown).

**Left out on purpose**

- **LLM rewriting/summarizing:** the point is to hear the article as written. An LLM pass adds cost and can change the meaning.
- **Real-time multiplayer:** it's a personal reader. Presence or shared rooms wouldn't add anything.
- **ElevenLabs:** Chatterbox clones a voice from a short clip and watermarks its output, which matters for a voice-cloning app.
- **Email/notifications:** narration takes 1–6 minutes, and the live progress view is enough.

## Main tradeoff: cost and safety vs. length and speed

Measured on the DeepSpace **free tier**: each Chatterbox request costs a flat **~$0.20**, regardless of length. fal's list price is $0.04 per 1,000 characters, and the integration notes that free-tier pricing differs. Cost therefore scales with the **number of requests**, so:

- Chunks are 600 characters (~40 s of speech), about as long as Chatterbox handles comfortably.
- Articles are capped at 5,000 characters (~5.5 min of audio, ~9 requests). Longer articles are cut at a sentence boundary and the user is told.
- Quotas: 2 episodes per user per day, 10 per day app-wide, and 10 URL fetches per user per day. They come from an **append-only `usage` ledger**, so deleting an episode doesn't give quota back. A failed job refunds quota only if nothing was spent on fal yet.

fal appears to process one account's parallel requests one after another, so a step of 4 chunks takes ~110 s and a full-length episode takes ~4 minutes. That's fine for a background job, since you can leave the page.

Audio is encoded to MP3 inside the Worker with a pure-JS encoder, one chunk per job step: 10 minutes of WAV is 29 MB, while the MP3 is 3.6 MB. Without that, a few episodes would fill the free plan's 128 MiB file allocation, and long ones would exceed the 25 MiB single-upload limit.

## Safety and security

- **Consent gate**: you can't save a voice without attesting it's yours or that you have permission. The timestamp is stored with the clip.
- **Watermark + disclosure**: Chatterbox HD embeds an inaudible watermark, and every episode is labeled as AI-generated.
- **Private by default**: the clip never gets a public URL. It's sent to fal inline as a data URI. You can delete your voice at any time, and replacing it deletes the old file.
- **Owner-credit protection**: the scaffold's `/api/integrations/*` proxy lets any signed-in user call any integration billed to the owner. It's **closed to the browser** (`browser: true` opt-in in `src/integrations.ts`). The job queue is admin-only, since browsers never enqueue jobs.
- **Storage protection**: the only browser file write allowed is a ≤2.5 MB upload to your own folder, with abandoned clips cleaned up and capped.
- **Interrupted jobs**: a worker restart can kill a job without running its error handler. An episode with no progress for 10 minutes is treated as interrupted, so it doesn't block the user forever.
- **No secrets in the repo**: integrations are billed through the platform. `.dev.vars` is generated and git-ignored.

## Verification

- `npm run test:unit`: text cleanup, sentence chunking, WAV parsing on real Chatterbox output, MP3 encoding, and staleness rules.
- `tests/readaloud.spec.ts` (Playwright, two test accounts):
  - signed-out users get 401
  - the integrations proxy returns 403 even when signed in
  - consent and foreign file keys are refused
  - **full path**: upload voice → consent → narrate → progress goes live → `ready` → the MP3 actually plays in the owner's browser (`audio/mpeg`, ~17 s) → the second user sees nothing, gets `not_found` deleting it, and gets **403** on the audio URL
- It runs locally (`npx deepspace test run e2e`) and against production:
  `DEEPSPACE_TEST_BROWSER_EXECUTABLE_PATH=… npx playwright test -c tests/playwright.live.config.ts`
- An opt-in long test (`READALOUD_LONG=1`) narrates a Wikipedia article across several job steps.

## Known limitations / what I'd do next

- **Multi-step stitching hasn't been verified end to end in production.** The long-article run got through several steps and then hit the account's credit limit. The single-step path is verified.
- **Cost**: at free-tier pricing, one full episode is ~$1.80. With credits or a paid plan, I'd re-measure and loosen the limits.
- **Speed**: the 4 parallel requests per step seem to run one after another on fal. Fewer, longer requests would help if quality holds. I'd A/B chunk sizes with real listeners.
- **Text extraction**: firecrawl's main-content mode is good, not perfect, and captions or footnotes sometimes get read. An optional "review text before narrating" step would fix that.
- **Abuse**: consent is an attestation, not verification. Speaker verification (comparing the clip with the account owner's voice) would be the next step.
- **Dev gotcha found during the build**: `deepspace dev` uses production's file storage (only records are local). A local test once deleted a production clip, which is why the orphan cleanup is age-based.

## Development

```sh
npm install
npx deepspace dev start          # http://localhost:5173
npm run test:unit
npx deepspace test run e2e       # needs 2 test accounts: npx deepspace test accounts create …
npx deepspace deploy             # commit first
```

## How this was built

I directed a coding agent (Claude Code). The agent scaffolded the app, read the DeepSpace docs and SDK source, wrote the code and tests, deployed it, and investigated failures.

These were found during testing rather than assumed:
- `ctx.continue` counts as a job attempt, so job-level retries don't help after the first step. Chunks retry inside a step instead.
- The open integrations proxy (owner-credit abuse).
- The delete-to-refund-quota loophole.
- Stuck "generating" episodes after a worker restart.
- The flat $0.20 free-tier charge per request, read from the billing ledger.
- Local dev sharing production file storage.

<!-- TODO (you): in your own words, add what you decided, what you checked yourself, and what you changed. -->
