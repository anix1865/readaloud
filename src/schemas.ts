/**
 * Collection Schemas: single source of truth for worker and frontend.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { voicesSchema } from './schemas/voices-schema'
import { episodesSchema } from './schemas/episodes-schema'
import { usageSchema } from './schemas/usage-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  voicesSchema,
  episodesSchema,
  usageSchema,
]
