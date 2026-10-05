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

/**
 * At most `limit + 1` bytes, so a large body is refused without being held whole; with a declared
 * length the bytes go straight into one buffer, held once rather than as chunks and a copy.
 */
export const readCapped = async (request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> => {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const declared = Number(request.headers.get('content-length') ?? NaN)
  if (Number.isInteger(declared) && declared >= 0 && declared <= limit) {
    const bytes = new Uint8Array(declared)
    let at = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // A body longer than it declared is cut at the cap, as an undeclared one is.
      if (at + value.byteLength > declared) {
        await reader.cancel()
        return new Uint8Array(limit + 1)
      }
      bytes.set(value, at)
      at += value.byteLength
    }
    return at === declared ? bytes : bytes.slice(0, at)
  }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      break
    }
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks.splice(0)) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}
