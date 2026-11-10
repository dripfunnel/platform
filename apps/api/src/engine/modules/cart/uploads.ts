import type { UploadMime } from '#db/scoped/uploads'

// A shopper's file checked by its content, never its name or declared type (PLATFORM-PROMPT §5.4 "Uploads"), pure.

export const maxUploadBytes = 10 * 1024 * 1024
export const maxCartUploads = 50

const starts = (bytes: Uint8Array, at: number, ascii: string) => [...ascii].every((c, i) => bytes[at + i] === c.charCodeAt(0))

/** What the bytes are, by their signature: JPEG, PNG, WebP, HEIC (an ISO box naming a HEIF brand) or PDF; null for anything else. */
export const sniffMime = (bytes: Uint8Array): UploadMime | null => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png'
  if (starts(bytes, 0, 'RIFF') && starts(bytes, 8, 'WEBP')) return 'image/webp'
  if (starts(bytes, 4, 'ftyp') && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].some((brand) => starts(bytes, 8, brand))) return 'image/heic'
  if (starts(bytes, 0, '%PDF-')) return 'application/pdf'
  return null
}

const images: readonly UploadMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

/** Whether an upload question takes this kind of file (CATALOG fact 53: Photos, PDF, or both). */
export const accepted = (accept: 'image' | 'pdf' | 'image_pdf', mime: UploadMime): boolean =>
  accept === 'image_pdf' ? true : accept === 'pdf' ? mime === 'application/pdf' : images.includes(mime)

export const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** The file ids a line's stored answers name. */
export const uploadsIn = (answers: readonly ({ uploads?: readonly string[] } | object)[] | null): string[] =>
  (answers ?? []).flatMap((a) => ('uploads' in a && Array.isArray(a.uploads) ? (a.uploads as string[]) : []))
