import { describe, expect, it } from 'vitest'
import { STALE_MS, isStale, isWorking } from './episodes'

describe('episode staleness', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('only running episodes can be stale', () => {
    expect(isWorking('generating')).toBe(true)
    expect(isWorking('queued')).toBe(true)
    expect(isStale('ready', ago(STALE_MS * 10), now)).toBe(false)
    expect(isStale('failed', ago(STALE_MS * 10), now)).toBe(false)
  })

  it('a running episode goes stale after STALE_MS without updates', () => {
    expect(isStale('generating', ago(60_000), now)).toBe(false)
    expect(isStale('generating', ago(STALE_MS + 1), now)).toBe(true)
    expect(isStale('queued', ago(STALE_MS + 1), now)).toBe(true)
  })
})
