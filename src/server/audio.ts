/**
 * Pure audio + text helpers for the narration pipeline. No I/O here, so
 * everything is unit-tested in audio.test.ts.
 */

import { Mp3Encoder } from '@breezystack/lamejs'

// ── Limits (shared by actions, job and UI) ─────────────────────────────────

export const LIMITS = {
  /** Max article length. ~10k chars ≈ 11 min of audio ≈ $0.40 of fal. */
  maxChars: 10_000,
  minChars: 200,
  /** Characters per Chatterbox request. Short inputs keep prosody stable. */
  chunkChars: 400,
  /** Chunks synthesized per job step (submitted to fal in parallel). */
  chunksPerStep: 4,
  /** Episodes a user may start per rolling 24h. */
  dailyEpisodes: 3,
  /** Article-URL fetches a user may make per rolling 24h (successful or not). */
  dailyScrapes: 15,
  /** Episodes the whole app may start per rolling 24h: a ceiling on owner spend. */
  appDailyEpisodes: 60,
  /** Voice clip bounds. The client normalizes clips to 24 kHz mono WAV. */
  clipMinSec: 5,
  clipMaxSec: 30,
  clipMaxBytes: 2 * 1024 * 1024,
  /** fal spend cap per chunk request (400 chars at $0.04/1k ≈ $0.016). */
  maxCostPerChunkUsd: 0.05,
} as const

// ── Text ───────────────────────────────────────────────────────────────────

/** Turn scraped Markdown into plain prose a narrator can read. */
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // code blocks are not listenable
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/<[^>]+>/g, ' ') // stray HTML
    .replace(/^\s{0,3}#{1,6}\s*/gm, '') // heading markers
    .replace(/^\s*[-*+]\s+/gm, '') // bullets
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/(\*\*|__|\*|_|`)/g, '') // emphasis, inline code
    .replace(/^\s*\|.*\|\s*$/gm, ' ') // tables
    .replace(/https?:\/\/\S+/g, ' ') // bare URLs
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Split text into chunks of at most `max` chars on sentence boundaries,
 * falling back to word boundaries for very long sentences.
 */
export function chunkText(text: string, max: number = LIMITS.chunkChars): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []
  const chunks: string[] = []
  let current = ''
  const push = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }
  for (const raw of sentences) {
    const s = raw.trim()
    if (!s) continue
    if (s.length > max) {
      push()
      let piece = ''
      for (const word of s.split(' ')) {
        if (piece && piece.length + word.length + 1 > max) {
          chunks.push(piece)
          piece = ''
        }
        piece = piece ? `${piece} ${word}` : word.slice(0, max)
      }
      if (piece) current = piece
      continue
    }
    if (current && current.length + s.length + 1 > max) push()
    current = current ? `${current} ${s}` : s
  }
  push()
  return chunks
}

// ── WAV ────────────────────────────────────────────────────────────────────

export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** Little-endian PCM bytes from the `data` chunk. */
  data: Uint8Array
  durationSec: number
}

/** Parse a PCM WAV, walking chunks (fal output includes a LIST chunk). */
export function parseWav(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3])
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let off = 12
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null
  while (off + 8 <= bytes.length) {
    const id = tag(off)
    const size = view.getUint32(off + 4, true)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt chunk')
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error('Only 16-bit PCM WAV is supported')
      const end = Math.min(body + size, bytes.length)
      const data = bytes.subarray(body, end)
      const frames = data.length / (2 * fmt.channels)
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        data,
        durationSec: frames / fmt.sampleRate,
      }
    }
    off = body + size + (size & 1)
  }
  throw new Error('WAV has no data chunk')
}

/** Encode 16-bit PCM WAV to mono MP3. Downmixes stereo by averaging. */
export function wavToMp3(wav: WavInfo, kbps = 48): Uint8Array {
  const samples = new Int16Array(wav.data.buffer.slice(wav.data.byteOffset, wav.data.byteOffset + (wav.data.byteLength & ~1)))
  let mono = samples
  if (wav.channels > 1) {
    mono = new Int16Array(Math.floor(samples.length / wav.channels))
    for (let i = 0; i < mono.length; i++) {
      let sum = 0
      for (let c = 0; c < wav.channels; c++) sum += samples[i * wav.channels + c]
      mono[i] = Math.round(sum / wav.channels)
    }
  }
  const encoder = new Mp3Encoder(1, wav.sampleRate, kbps)
  const parts: Uint8Array[] = []
  for (let i = 0; i < mono.length; i += 1152) {
    const out = encoder.encodeBuffer(mono.subarray(i, i + 1152))
    if (out.length) parts.push(new Uint8Array(out))
  }
  const tail = encoder.flush()
  if (tail.length) parts.push(new Uint8Array(tail))
  return concatBytes(parts)
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}
