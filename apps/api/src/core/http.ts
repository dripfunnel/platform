import type { z } from 'zod'

export const json = (status: number, body: unknown, cookie?: string): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) } })

/** A refusal's status: 429 for throttling, 400 for what the user can fix, 401 for anything about who they are. */
export const refusalResponse = <R extends { code: string }>(refusal: R, badRequest: ReadonlySet<R['code']>): Response =>
  json(refusal.code === 'RATE_LIMITED' ? 429 : badRequest.has(refusal.code) ? 400 : 401, { ok: false, ...refusal })

export const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T | null> => {
  try {
    const parsed = schema.safeParse(await request.json())
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type CappedBody = { ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false }

/**
 * The body, or `{ ok: false }` once it passes `limit` or the length it declared. The buffer grows only as
 * bytes arrive, so a declared length the client never sends holds nothing (a stalled upload pins no memory).
 */
export const readCapped = async (request: { headers: Headers; body: ReadableStream<Uint8Array> | null }, limit: number): Promise<CappedBody> => {
  const declared = Number(request.headers.get('content-length') ?? NaN)
  const cap = Number.isInteger(declared) && declared >= 0 ? Math.min(declared, limit) : limit
  if (Number.isInteger(declared) && declared > limit) return { ok: false }
  const reader = request.body?.getReader()
  if (!reader) return { ok: true, bytes: new Uint8Array() }
  let bytes = new Uint8Array(0)
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > cap) {
      await reader.cancel()
      return { ok: false }
    }
    if (size + value.byteLength > bytes.byteLength) {
      const grown = new Uint8Array(Math.min(cap, Math.max(size + value.byteLength, bytes.byteLength * 2, 64 * 1024)))
      grown.set(bytes.subarray(0, size))
      bytes = grown
    }
    bytes.set(value, size)
    size += value.byteLength
  }
  return { ok: true, bytes: size === bytes.byteLength ? bytes : bytes.slice(0, size) }
}
