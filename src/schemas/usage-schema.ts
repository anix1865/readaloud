import type { CollectionSchema } from 'deepspace/schema'

/**
 * Append-only ledger of narrations started, used for the per-user daily
 * limit. Kept separate from `episodes` so deleting an episode never refunds
 * quota. Server-written only; users can read their own rows.
 */
export const usageSchema: CollectionSchema = {
  name: 'usage',
  columns: [
    { name: 'kind', storage: 'text', interpretation: 'plain' },
    { name: 'episodeId', storage: 'text', interpretation: 'plain' },
    { name: 'chars', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
