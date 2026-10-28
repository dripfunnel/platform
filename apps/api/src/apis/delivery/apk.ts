import type postgres from 'postgres'
import type { DeliveryCaller } from '#auth/riderCaller'
import { withSystemScope } from '#db/scoped/index'
import { selectLatestDeliveryApp } from '#db/scoped/storeDeliveryApp'
import { apkContentType } from '#saas/deliveryApp/files'

// `GET /app/delivery.apk` on a store's free address: the store's newest delivery app, streamed from R2 (DELIVERY §5). Public by design:
// it is the link in the rider's invitation text and holds no store data.

export const deliveryApkPath = '/app/delivery.apk'

export interface ApkFiles {
  get(key: string): Promise<{ body: ReadableStream } | null>
}

const missing = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

export const handleDeliveryApk = async (request: Request, sql: postgres.Sql, caller: DeliveryCaller, files: ApkFiles | null): Promise<Response> => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } })
  if (!caller.available || !files) return missing()
  const app = await withSystemScope(sql, (tx) => selectLatestDeliveryApp(tx, caller.storeId))
  const object = app ? await files.get(app.apk_key) : null
  if (!app || !object) return missing()
  return new Response(object.body, {
    headers: {
      'content-type': apkContentType,
      'content-length': app.size_bytes,
      'content-disposition': `attachment; filename="delivery-${app.version_name}.apk"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
}
