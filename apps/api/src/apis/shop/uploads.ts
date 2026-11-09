import type { CartRefusal, UploadStore } from '#engine/modules/cart/index'
import { maxUploadBytes } from '#engine/modules/cart/uploads'
import type { ShopContext } from './access'
import { cartOf } from './cart'

// `POST /shop-api/uploads?question={id}` (the raw file) and `DELETE /shop-api/uploads/{id}`: a shopper's file for an upload
// question (PLATFORM-PROMPT §5.4 "Uploads", #1369). Checked by content, bounded per cart and per host and address, never
// logged by name or content; the engine decides everything else.

export const uploadsPath = '/shop-api/uploads'
export const isUploadPath = (pathname: string): boolean => pathname === uploadsPath || pathname.startsWith(`${uploadsPath}/`)

const words: Partial<Record<CartRefusal, [number, string]>> = {
  FILE_TYPE: [415, 'That file isn’t one this question takes. Use a photo (JPG, PNG, WebP or HEIC) or a PDF, as it says.'],
  FILE_TOO_LARGE: [413, 'That file is over 10 MB. Choose a smaller one.'],
  UNKNOWN_QUESTION: [404, 'That question isn’t here any more.'],
  TOO_MANY_UPLOADS: [409, 'Your cart already holds 50 files. Remove one to add another.'],
  UPLOAD_NOT_FOUND: [404, 'That file isn’t in your cart.'],
  UPLOAD_IN_USE: [409, 'That file is part of an item in your cart. Edit the item to remove it.'],
  RATE_LIMITED: [429, 'Too many new carts from here. Wait a minute and try again.'],
  NO_CART: [404, 'Your cart has expired. Add something to start again.'],
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const refused = (code: CartRefusal | 'RATE_LIMITED' | 'UNAVAILABLE' | 'METHOD', fallback = 'Something here isn’t valid.') => {
  const [status, message] = words[code as CartRefusal] ?? (code === 'UNAVAILABLE' ? [503, 'Uploads aren’t available here.'] : code === 'METHOD' ? [405, 'Method not allowed.'] : [400, fallback])
  return json(status, { errors: [{ message, extensions: { code } }] })
}

/** The body, counted as it streams: past `max` the read stops at once, so an oversize file is never held whole. */
const readCapped = async (request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> => {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    body.set(chunk, at)
    at += chunk.byteLength
  }
  return body
}

/** What a file is, for the storefront's list: the kinds the answer shows (no file name is kept). */
const kindOf = (mime: string) => (mime === 'application/pdf' ? 'pdf' : 'image')

export const handleUpload = async (request: Request, ctx: ShopContext, files: UploadStore | null): Promise<Response> => {
  const url = new URL(request.url)
  if (!ctx.sql || !ctx.shopper || !files) return refused('UNAVAILABLE')
  const ip = ctx.facts.ip
  const deny = async () => false
  // Carts cost nothing to make, so the address is bounded as well as the cart (20 and 10 a minute).
  if (!ip || !(await (ctx.allowUploadFromAddress ?? deny)(`upload:${url.hostname}:${ip}`))) return json(429, { errors: [{ message: 'Too many files from here. Wait a minute and try again.', extensions: { code: 'RATE_LIMITED' } }] })
  const cartKey = request.headers.get('x-shop-cart') ?? ctx.sessionToken ?? `new:${ip}`
  if (!(await (ctx.allowUploadToCart ?? deny)(`upload-cart:${ctx.shopper.context.storeId}:${cartKey}`))) return json(429, { errors: [{ message: 'Too many files for this cart. Wait a minute and try again.', extensions: { code: 'RATE_LIMITED' } }] })
  const cart = await cartOf(ctx)
  if (request.method === 'POST' && url.pathname === uploadsPath) {
    if (Number(request.headers.get('content-length') ?? '0') > maxUploadBytes) return refused('FILE_TOO_LARGE')
    // A chunked or understated body is capped as it's read, whatever its header said.
    const body = await readCapped(request, maxUploadBytes)
    if (!body) return refused('FILE_TOO_LARGE')
    const result = await cart.upload(url.searchParams.get('question') ?? '', body, files)
    if (!result.ok) return refused(result.reason)
    return json(200, { id: result.value.id, kind: kindOf(result.value.mime), cartToken: result.value.token })
  }
  if (request.method === 'DELETE' && url.pathname.startsWith(`${uploadsPath}/`)) {
    const result = await cart.removeUpload(url.pathname.slice(uploadsPath.length + 1))
    return result.ok ? json(200, { removed: true }) : refused(result.reason)
  }
  return refused('METHOD')
}
