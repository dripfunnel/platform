import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import type { LinkSigner } from '#auth/signedLink'
import { isUuid } from '#core/ids'
import { assignKeys, insertDownload, issueOrderGiftCard, lockDownloadToServe, queueEmail, selectLinesWaitingForKeys, selectOrderToDeliver, sendTimeOf, spendDownload } from '#db/scoped/deliveries'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'

// What a paid order's downloads and gift cards become (CATALOG-DESIGN T14; FIRST-RELEASE §19): run in the payment's own
// transaction, so nothing is handed out for a payment that didn't commit, and idempotent, so a replay hands out nothing
// twice. "Never before" payment: a transfer or cash order delivers when marked paid (CatEditor). A service needs nothing.

export const deliveryAudit = { keysShort: 'order.licence_keys_short' } as const

/** The links and keys email, once each time something new is ready on the order. */
const tellDownloads = (tx: ScopedSql, partnerId: string, storeId: string, orderId: string, key: string) =>
  queueEmail(tx, { partnerId, storeId, key: `downloads:${orderId}:${key}`, payload: { template: 'order-downloads', orderId } })

export const deliverOrder = async (tx: ScopedSql, activity: ActivityLog, storeId: string, orderId: string, at: Date): Promise<void> => {
  const order = await selectOrderToDeliver(tx, storeId, orderId)
  if (!order || order.test) return
  let ready = false
  let short = 0
  for (const line of order.lines) {
    if (line.product_type === 'digital' && line.download_mode === 'keys') {
      const keys = await assignKeys(tx, storeId, line.product_id, line.id, line.quantity, at)
      ready ||= keys.assigned > 0
      short += keys.short
    } else if (line.product_type === 'digital' && line.download_asset_id) {
      ready = (await insertDownload(tx, { storeId, orderId, lineId: line.id, assetId: line.download_asset_id, uses: line.download_limit, expiresAt: new Date(at.getTime() + line.download_days * 86_400_000) })) || ready
    } else if (line.product_type === 'gift_card' && line.gift_recipient_email) {
      const card = await issueOrderGiftCard(tx, {
        storeId,
        orderId,
        lineId: line.id,
        productId: line.product_id,
        currency: order.currency,
        // The card is worth its price before any offer, as the shopper chose it (decided on #323).
        amount: BigInt(line.unit_amount),
        expiryMonths: line.gift_card_expiry_months,
        recipientName: line.gift_recipient_name,
        recipientEmail: line.gift_recipient_email,
        message: line.gift_message,
        sendOn: line.gift_send_on,
      })
      if (card) await queueEmail(tx, { partnerId: order.partner_id, storeId, key: `gift-card:${card}`, payload: { template: 'gift-card', giftCardId: card }, notBefore: await sendTimeOf(tx, line.gift_send_on, order.time_zone, at) })
    }
  }
  if (ready) await tellDownloads(tx, order.partner_id, storeId, orderId, 'paid')
  // Sold past the pool as stock is sold past what is free: the merchant adds keys, which go to this order (fillKeys).
  if (short > 0) {
    await activity.record(tx, {
      category: 'system',
      action: deliveryAudit.keysShort,
      result: 'failed',
      actorKind: 'job',
      actorId: null,
      actorLabel: null,
      partnerId: order.partner_id,
      storeId,
      target: { type: 'order', id: orderId, label: order.number },
      reason: String(short),
      api: 'system',
      visibility: 'store',
      requestId: null,
      ip: null,
      userAgent: null,
    })
  }
}

/** New keys go to the paid orders still waiting for one, oldest first, each told once its keys are ready. */
export const fillKeys = (sql: postgres.Sql, storeId: string, productId: string, at: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    let filled = 0
    for (const line of await selectLinesWaitingForKeys(tx, storeId, productId)) {
      const keys = await assignKeys(tx, storeId, productId, line.id, line.quantity, at)
      if (keys.assigned === 0) break
      filled += keys.assigned
      await tellDownloads(tx, line.partner_id, storeId, line.order_id, `keys:${line.id}:${at.getTime()}`)
    }
    return filled
  })

/** Where a paid download is fetched from (apis/shop/downloads.ts): its grant and the grant's signature, never a token kept. */
export const downloadPath = '/shop-api/downloads'

const downloadMessage = (storeId: string, grantId: string) => `download:${storeId}:${grantId}`

export const downloadUrl = async (signer: LinkSigner, host: string, storeId: string, grantId: string): Promise<string> => `https://${host}${downloadPath}/${grantId}.${await signer.sign(downloadMessage(storeId, grantId))}`

/** The grant a link names, when its signature is this store's; null for anything else. */
export const downloadGrantOf = async (signer: LinkSigner, storeId: string, token: string): Promise<string | null> => {
  const [grantId, signature, ...rest] = token.split('.')
  if (!grantId || !signature || rest.length > 0 || !isUuid(grantId)) return null
  return (await signer.verify(downloadMessage(storeId, grantId.toLowerCase()), signature)) ? grantId.toLowerCase() : null
}

export interface DownloadDeps {
  sql: postgres.Sql
  storeId: string
  signer: LinkSigner
  files: { get: (key: string) => Promise<{ body: ReadableStream } | null> }
  now: () => Date
}

/**
 * A paid download's file, one use spent; null alike for a link that is unknown, another store's, expired, used up or
 * of a refunded order (FIRST-RELEASE §19: one refusal), and for a file gone from R2, which spends nothing.
 */
export const openDownload = async ({ sql, storeId, signer, files, now }: DownloadDeps, token: string): Promise<{ body: ReadableStream; mime: string; bytes: number; filename: string } | null> => {
  const grantId = await downloadGrantOf(signer, storeId, token)
  if (!grantId) return null
  return withSystemScope(sql, async (tx) => {
    const row = await lockDownloadToServe(tx, storeId, grantId, now())
    const object = row ? await files.get(row.r2_key) : null
    if (!row || !object) return null
    await spendDownload(tx, grantId)
    const ext = row.r2_key.slice(row.r2_key.lastIndexOf('.') + 1)
    const base = row.name.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).toLowerCase() || 'download'
    return { body: object.body, mime: row.mime, bytes: row.bytes, filename: `${base}.${ext}` }
  })
}
