import { z } from 'zod'

// A URL is typed by anyone, so a value that doesn't fit is dropped rather than failing the
// page: the screen then shows its unfiltered default.
export const optionalParam = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined)

export const idParam = optionalParam(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
