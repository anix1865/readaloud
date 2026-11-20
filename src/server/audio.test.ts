/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIMITS, bytesToBase64, chunkText, concatBytes, markdownToSpeech, parseWav, wavToMp3 } from './audio'

const sample = new Uint8Array(readFileSync(new URL('../../tests/fixtures/chatterbox-sample.wav', import.meta.url)))

describe('markdownToSpeech', () => {
  it('keeps prose and drops markup', () => {
    const md = '# Title\n\nSee [the docs](https://x.y) and ![img](a.png).\n\n```js\ncode()\n```\n- **Bold** point\n> quote'
    const out = markdownToSpeech(md)
    expect(out).toContain('Title')
    expect(out).toContain('See the docs and')
    expect(out).toContain('Bold point')
    expect(out).toContain('quote')
    expect(out).not.toMatch(/https?:|\]\(|```|code\(\)|\*\*|#/)
  })
})

describe('chunkText', () => {
  it('splits on sentences under the limit and loses no words', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const chunks = chunkText(text, 120)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120)
    expect(chunks.every((c) => c.endsWith('.'))).toBe(true)
    expect(chunks.join(' ').split(' ').length).toBe(text.split(' ').length)
  })

  it('breaks a run-on sentence on word boundaries', () => {
    const text = 'word '.repeat(300).trim()
    const chunks = chunkText(text, 100)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
    expect(chunks.join(' ').split(' ').length).toBe(300)
  })

  it('handles text without terminal punctuation', () => {
    expect(chunkText('no punctuation at all')).toEqual(['no punctuation at all'])
  })

  it('keeps a max-size article to a bounded number of fal calls', () => {
    const text = 'This is a typical sentence in an article. '.repeat(LIMITS.maxChars / 42)
    expect(chunkText(text).length).toBeLessThanOrEqual(Math.ceil(LIMITS.maxChars / (LIMITS.chunkChars * 0.85)))
  })
})

describe('parseWav', () => {
  it('reads real Chatterbox output (with a LIST chunk)', () => {
    const wav = parseWav(sample)
    expect(wav.sampleRate).toBe(24000)
    expect(wav.channels).toBe(1)
    expect(wav.durationSec).toBeCloseTo(4.9, 1)
  })

  it('rejects non-WAV input', () => {
    expect(() => parseWav(new TextEncoder().encode('<html>'.repeat(20)))).toThrow()
  })
})

describe('wavToMp3', () => {
  it('produces a much smaller MP3 stream', () => {
    const mp3 = wavToMp3(parseWav(sample))
    expect(mp3[0]).toBe(0xff) // MPEG frame sync
    expect(mp3.length).toBeLessThan(sample.length / 4)
  })
})

describe('bytes helpers', () => {
  it('round-trips base64 and concatenates', () => {
    const a = new Uint8Array([1, 2, 3])
    expect(atob(bytesToBase64(a))).toBe('\x01\x02\x03')
    expect([...concatBytes([a, new Uint8Array([4])])]).toEqual([1, 2, 3, 4])
  })
})
