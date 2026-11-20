/**
 * Browser-side voice clip normalization: decode any audio the browser can
 * play (mp3, m4a, webm/opus recordings, wav…), downmix to mono, resample to
 * 24 kHz and encode 16-bit PCM WAV, the format Chatterbox outputs and the
 * server validates. A 30 s clip is ~1.4 MB.
 */

export const CLIP_RATE = 24_000
export const CLIP_MIN_SEC = 5
export const CLIP_MAX_SEC = 30

export interface NormalizedClip {
  wav: Blob
  durationSec: number
  trimmed: boolean
}

export async function normalizeClip(input: Blob): Promise<NormalizedClip> {
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await input.arrayBuffer())
  } catch {
    throw new Error('That file could not be read as audio.')
  } finally {
    void ctx.close()
  }
  const trimmed = decoded.duration > CLIP_MAX_SEC
  const durationSec = Math.min(decoded.duration, CLIP_MAX_SEC)
  if (durationSec < CLIP_MIN_SEC) throw new Error(`The clip is too short. Use at least ${CLIP_MIN_SEC} seconds of speech.`)

  const frames = Math.round(durationSec * CLIP_RATE)
  const offline = new OfflineAudioContext(1, frames, CLIP_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination) // the graph downmixes to the 1-channel destination
  src.start()
  const rendered = await offline.startRendering()
  return { wav: encodeWav(rendered.getChannelData(0), CLIP_RATE), durationSec, trimmed }
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
