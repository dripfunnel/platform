import type { LinkSigner } from '#auth/signedLink'
import { isUuid } from '#core/ids'
import { shopperFiles } from '#engine/modules/cart/index'
import type { AssetStore } from '#engine/modules/catalog/index'
import type { StoreContext } from './access'

// `GET /api/shopper-uploads/{store}/{file}.{expires}.{signature}`: a shopper's uploaded file on an order line (#1369;
// DATA-MODEL §7.11), opened only through a link the Store API signed for the merchant side or the line's supplier, for
// 10 minutes. The link carries its own proof, so an image tag or the merchant app can open it without a session.

export const shopperUploadsPath = '/api/shopper-uploads'
export const uploadLinkSeconds = 600

export const isShopperUploadPath = (pathname: string): boolean => pathname.startsWith(`${shopperUploadsPath}/`)

const messageOf = (storeId: string, fileId: string, expires: number) => `${storeId}:${fileId}:${expires}`

/** A link to one file, good for 10 minutes. */
export const shopperUploadUrl = async (signer: LinkSigner, storeId: string, fileId: string, now: Date): Promise<string> => {
  const expires = Math.floor(now.getTime() / 1000) + uploadLinkSeconds
  return `${shopperUploadsPath}/${storeId}/${fileId}.${expires}.${await signer.sign(messageOf(storeId, fileId, expires))}`
}

export const handleShopperUpload = async (request: Request, ctx: Pick<StoreContext, 'sql' | 'now'> & { uploadLinks?: LinkSigner | null }, files: AssetStore | null): Promise<Response> => {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const closed = () => new Response(JSON.stringify({ ok: false, code: 'LINK_CLOSED' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  const [storeId, rest] = new URL(request.url).pathname.slice(shopperUploadsPath.length + 1).split('/')
  const [fileId, expiresText, signature] = (rest ?? '').split('.')
  const expires = Number(expiresText)
  if (!ctx.sql || !files || !ctx.uploadLinks || !storeId || !fileId || !signature || !isUuid(storeId) || !isUuid(fileId) || !Number.isInteger(expires)) return closed()
  if (expires * 1000 < ctx.now().getTime() || !(await ctx.uploadLinks.verify(messageOf(storeId, fileId, expires), signature))) return closed()
  const [file] = await shopperFiles(ctx.sql, storeId, [fileId])
  const object = file ? await files.get(file.r2_key) : null
  if (!file || !object) return closed()
  return new Response(object.body, {
    headers: {
      'content-type': file.mime,
      'content-length': String(file.bytes),
      // A photo shows in the order page; a PDF downloads. Never run as the portal's own content.
      'content-disposition': file.mime === 'application/pdf' ? `attachment; filename="${fileId}.pdf"` : 'inline',
      'cache-control': `private, max-age=${uploadLinkSeconds}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'",
    },
  })
}
