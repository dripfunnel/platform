import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { hashGiftCardCode, normaliseGiftCardCode } from '#auth/giftCardCodes'
import { cleanEmail } from '#core/email'
import { isUuid } from '#core/ids'
import type { Money } from '#core/money'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { queueEmail } from '#db/scoped/deliveries'
import { insertIssuedGiftCard, selectGiftCardAmount, selectGiftCardByCode, selectIssuedGiftCards, selectUsableGiftCard, type IssuedGiftCardRow } from '#db/scoped/giftCards'
import { withScope, withSystemScope } from '#db/scoped/index'

export type { IssuedGiftCardRow } from '#db/scoped/giftCards'

// A gift card's balance and the merchant's cards issued (CatEditor; FIRST-RELEASE §19). A code is looked up by its hash in
// the store whose shop asks, so a code never opens another store's card, and every refusal is the same one.

export const giftCardsAudit = { issued: 'gift_card.issued' } as const

export interface GiftCardView {
  id: string
  last4: string
  balance: Money
  expiresAt: Date | null
}

const viewOf = (row: { id: string; code_last4: string; balance_amount: string; currency: string; expires_at: Date | null }): GiftCardView => ({
  id: row.id,
  last4: row.code_last4,
  balance: { amount: BigInt(row.balance_amount), currency: row.currency },
  expiresAt: row.expires_at,
})

/** The card a typed code opens in this store, while it can be spent; null for anything else. */
export const findGiftCard = async (sql: postgres.Sql, storeId: string, typed: string, at: Date): Promise<GiftCardView | null> => {
  const code = normaliseGiftCardCode(typed)
  if (!code) return null
  const hash = await hashGiftCardCode(storeId, code)
  // System scope: no request role reads a card, and the store comes from the shop's host, never from input.
  const row = await withSystemScope(sql, (tx) => selectGiftCardByCode(tx, storeId, hash, at))
  return row ? viewOf(row) : null
}

/** A cart's card by its id, while it can still be spent. */
export const giftCardById = async (sql: postgres.Sql, storeId: string, id: string, at: Date): Promise<GiftCardView | null> => {
  const row = await withSystemScope(sql, (tx) => selectUsableGiftCard(tx, storeId, id, at))
  return row ? viewOf(row) : null
}

export type GiftCardRefusal = 'NOT_FOUND' | 'INVALID_INPUT' | 'READ_ONLY' | 'KEY_REUSED'
export type GiftCardResult<T> = { ok: true; value: T } | { ok: false; reason: GiftCardRefusal }

export interface GiftCardDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createGiftCardService = ({ sql, context, actor, activity, facts }: GiftCardDeps) => {
  const { storeId } = context

  /** A gift card product's cards issued, newest first; none when the product isn't the caller's to read. */
  const issued = (productId: string, window: PageWindow): Promise<IssuedGiftCardRow[]> =>
    isUuid(productId) ? withScope(sql, context, (tx) => selectIssuedGiftCards(tx, storeId, productId.toLowerCase(), window)) : Promise.resolve([])

  /** "Issue a card" (CatEditor): one of the product's amounts, emailed now and logged under the person's name. */
  const issue = async (productId: string, versionId: string, input: { email: string; name: string | null; issueKey: string }): Promise<GiftCardResult<string>> => {
    if (context.caller.kind === 'support' && context.caller.access === 'read') return { ok: false, reason: 'READ_ONLY' }
    const email = cleanEmail(input.email)
    const name = input.name?.trim() || null
    if (!email || (name?.length ?? 0) > 120 || !isUuid(productId) || !isUuid(versionId) || !isUuid(input.issueKey)) return { ok: false, reason: 'INVALID_INPUT' }
    // Read in the caller's scope, so only the acting store's own gift card product can be issued from.
    const amount = await withScope(sql, context, (tx) => selectGiftCardAmount(tx, storeId, productId.toLowerCase(), versionId.toLowerCase()))
    if (!amount) return { ok: false, reason: 'NOT_FOUND' }
    const id = await withSystemScope(sql, async (tx) => {
      const card = await insertIssuedGiftCard(tx, { storeId, productId: amount.product_id, currency: amount.currency, amount: BigInt(amount.amount), expiryMonths: amount.expiry_months, recipientName: name, recipientEmail: email, issuedBy: actor.id, issueKey: input.issueKey.toLowerCase() })
      // A replay of the same request answers the card it made, emailed and logged once.
      if (!card || !card.created) return card?.id ?? null
      const made = card.id
      await queueEmail(tx, { partnerId: amount.partner_id, storeId, key: `gift-card:${made}`, payload: { template: 'gift-card', giftCardId: made } })
      await activity.record(tx, {
        category: 'write',
        action: giftCardsAudit.issued,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'gift_card', id: made, label: amount.product_name },
        // The amount, never the recipient or the code (LOGGING §4).
        reason: `${amount.currency} ${amount.amount}`,
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return made
    })
    return id ? { ok: true, value: id } : { ok: false, reason: 'KEY_REUSED' }
  }

  return { issued, issue }
}
