import { z } from 'zod'
import { optionalParam } from '@dripfunnel/shared/search'

// A page cursor is base64url of a time or sort value and an id (apps/api core/cursor.ts), longer than an id.
export const cursorParam = optionalParam(z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/))
