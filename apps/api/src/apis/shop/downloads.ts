import { downloadPath, openDownload } from '#engine/modules/deliveries/index'
import type { ShopContext } from './access'

// `GET /shop-api/downloads/{grant}.{signature}`: a paid order's file, streamed from R2 through the Worker, never from a
// public address (CATALOG-DESIGN T14). Rate-limited per host and address, with one refusal for every link that won't open.

export const isDownloadPath = (pathname: string): boolean => pathname.startsWith(`${downloadPath}/`)

const refusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ errors: [{ message, extensions: { code } }] }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const handleDownload = async (request: Request, ctx: ShopContext, files: { get: (key: string) => Promise<{ body: ReadableStream } | null> } | null): Promise<Response> => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const url = new URL(request.url)
  const { ip } = ctx.facts
  if (!ip || !(await (ctx.allowDownload ?? (async () => false))(`download:${url.hostname}:${ip}`))) return refusal(429, 'RATE_LIMITED', 'Too many tries. Wait a minute and try again.')
  const closed = () => refusal(404, 'LINK_CLOSED', 'This download link doesn’t work any more. Open your order to get a new one, or contact the shop.')
  if (!ctx.sql || !ctx.shopper || !ctx.downloadLinks || !files) return closed()
  const file = await openDownload({ sql: ctx.sql, storeId: ctx.shopper.context.storeId, signer: ctx.downloadLinks, files, now: ctx.now }, url.pathname.slice(downloadPath.length + 1))
  if (!file) return closed()
  return new Response(file.body, {
    headers: {
      'content-type': file.mime,
      'content-length': String(file.bytes),
      'content-disposition': `attachment; filename="${file.filename}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}
