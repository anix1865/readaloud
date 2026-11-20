import type { CollectionSchema } from 'deepspace/schema'

export const EPISODE_STATUSES = ['queued', 'generating', 'ready', 'failed'] as const
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number]

export interface Episode {
  title: string
  sourceUrl: string
  text: string
  chars: number
  status: EpisodeStatus
  progress: number
  chunksDone: number
  chunksTotal: number
  audioKey: string
  durationSec: number
  error: string
  voiceLabel: string
}

/**
 * Narrated articles. Private to their creator. The narration job updates
 * status/progress as it runs, and the page renders those updates live through
 * the record subscription, so there is no polling.
 */
export const episodesSchema: CollectionSchema = {
  name: 'episodes',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'sourceUrl', storage: 'text', interpretation: { kind: 'url' } },
    { name: 'text', storage: 'text', interpretation: 'plain' },
    { name: 'chars', storage: 'number', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...EPISODE_STATUSES] } },
    { name: 'progress', storage: 'number', interpretation: { kind: 'percent' } },
    { name: 'chunksDone', storage: 'number', interpretation: 'plain' },
    { name: 'chunksTotal', storage: 'number', interpretation: 'plain' },
    { name: 'audioKey', storage: 'text', interpretation: 'plain' },
    { name: 'durationSec', storage: 'number', interpretation: 'plain' },
    { name: 'error', storage: 'text', interpretation: 'plain' },
    { name: 'voiceLabel', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
