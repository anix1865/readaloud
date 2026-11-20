/**
 * Shared episode rules for the worker and the UI.
 *
 * A running narration writes progress every step (~20–40 s). If a worker
 * restart (a deploy, an eviction) kills the job mid-step, nothing marks the
 * episode failed, so an episode with no update for STALE_MS is treated as
 * interrupted: it no longer blocks new episodes and it can be deleted.
 */
export const STALE_MS = 10 * 60 * 1000

export function isWorking(status: string): boolean {
  return status === 'queued' || status === 'generating'
}

export function isStale(status: string, updatedAt: string | undefined, now = Date.now()): boolean {
  return isWorking(status) && !!updatedAt && now - Date.parse(updatedAt) > STALE_MS
}
