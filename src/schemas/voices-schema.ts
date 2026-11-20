import type { CollectionSchema } from 'deepspace/schema'

/**
 * One row per user: their active cloning voice.
 *
 * Only the owner can read it; nobody can write it from the browser. The
 * `setVoice` / `deleteVoice` actions own every write so the consent record,
 * the clip validation and the deletion of the previous clip happen together.
 */
export const voicesSchema: CollectionSchema = {
  name: 'voices',
  columns: [
    { name: 'fileKey', storage: 'text', interpretation: 'plain' },
    { name: 'label', storage: 'text', interpretation: 'plain' },
    { name: 'durationSec', storage: 'number', interpretation: 'plain' },
    { name: 'sizeBytes', storage: 'number', interpretation: 'plain' },
    // ISO timestamp of the "this is my voice / I have permission" attestation.
    { name: 'consentAt', storage: 'text', interpretation: { kind: 'datetime' } },
  ],
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
