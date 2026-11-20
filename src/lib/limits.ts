/**
 * Product limits, shared by server actions, the narration job and the UI.
 *
 * Cost model (measured, not assumed): on the DeepSpace free tier each
 * Chatterbox HD request through fal is charged a flat ~$0.20 regardless of
 * length (fal's list price is $0.04 per 1,000 characters; the integration
 * notes that free-tier pricing differs). So the number of requests per
 * episode drives cost: chunks are as long as Chatterbox handles comfortably,
 * and articles are capped.
 */
export const LIMITS = {
  /** Max article length: ~5,000 chars ≈ 5.5 min of audio ≈ 9 requests. */
  maxChars: 5_000,
  minChars: 200,
  /** Characters per Chatterbox request (~40 s of speech). */
  chunkChars: 600,
  /** Chunks synthesized per job step (submitted to fal in parallel). */
  chunksPerStep: 4,
  /** Episodes a user may start per rolling 24h. */
  dailyEpisodes: 2,
  /** Article-URL fetches a user may make per rolling 24h (successful or not). */
  dailyScrapes: 10,
  /** Episodes the whole app may start per rolling 24h: a ceiling on owner spend. */
  appDailyEpisodes: 10,
  /** Voice clip bounds. The client normalizes clips to 24 kHz mono WAV. */
  clipMinSec: 5,
  clipMaxSec: 30,
  clipMaxBytes: 2 * 1024 * 1024,
  /** fal-side spend cap per chunk request. */
  maxCostPerChunkUsd: 0.25,
} as const

/** Approximate listening time for a character count (~15 chars/s). */
export function approxMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 15 / 60))
}
