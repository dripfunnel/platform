import { z } from 'zod'
import type { Branded } from '../../pricing/brand'

// Images and video from the store's media (ARCHITECTURE §2.1 `platform/media`): only core's decoders make a Photo or a
// VideoFile, so a theme shows the catalogue's pictures and never an address of its own (§3.4).

/** A picture from the Shop API; `main` is the one picture core lets load first on its page. */
export type Photo = Branded<{ url: string; alt: string | null; main: boolean }, 'Photo'>
export type VideoFile = Branded<{ url: string }, 'VideoFile'>

const url = z.string().min(1).max(2048)

export const photoOf = (address: string, alt: string | null): Photo => ({ url: address, alt, main: false }) as Photo

/** ShopPhoto as a Photo; null when it has no address. */
export const photoSchema = z
  .object({ image: z.object({ url: url.nullable().optional() }).nullable().optional(), alt: z.string().nullable().optional() })
  .transform((p) => (p.image?.url ? photoOf(p.image.url, p.alt ?? null) : null))

export const imageSchema = z
  .object({ url: url.nullable().optional() })
  .nullable()
  .optional()
  .transform((i) => (i?.url ? photoOf(i.url, null) : null))

export const videoSchema = z
  .object({ file: z.object({ url: url.nullable().optional() }).nullable().optional() })
  .nullable()
  .optional()
  .transform((v) => (v?.file?.url ? ({ url: v.file.url } as VideoFile) : null))

/** The page's first picture, the only one loaded eagerly. */
export const asMain = (photo: Photo): Photo => ({ ...photo, main: true }) as Photo
