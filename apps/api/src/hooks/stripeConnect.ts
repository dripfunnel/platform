import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { hashSessionId, newSessionId } from '#auth/session'
import { logEvent } from '#core/log'
import type { OAuthConnect } from '#core/payments'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { approveConnect, deleteConnect, selectPendingConnect, type ConnectRow } from '#db/scoped/payments'
import { finishConnectMs } from '#engine/modules/checkout/setup'

// hooks.<host>/stripe/connect/callback (THIRD-PARTY-ACCESS §3.1): Stripe's one redirect for Connect OAuth, finished by its
// starter with a one-time key in their own portal, as Connect Shopify is (hooks/shopify.ts).
export const stripeConnectCallbackPath = '/stripe/connect/callback'

export interface StripeConnectHookDeps {
  sql: postgres.Sql
  connect: OAuthConnect
  activity: ActivityLog
  now: () => Date
}

const back = (host: string, query: string) => Response.redirect(`https://${host}/settings/payments?${query}`, 302)
const expired = () => new Response('This link has expired. Go back to your store and connect Stripe again.', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } })

export const handleStripeConnectCallback = async (request: Request, { sql, connect, activity, now }: StripeConnectHookDeps): Promise<Response> => {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const query = new URL(request.url).searchParams
  const state = query.get('state') ?? ''
  if (!/^[0-9a-f]{64}$/.test(state)) return expired()
  const pending = await withSystemScope(sql, async (tx) => selectPendingConnect(tx, await hashSessionId(state)))
  if (!pending || pending.expires_at < now()) return expired()
  // Stripe's answer is logged on the store's activity as the provider's, with what became of it (LOGGING §3).
  const record = (tx: ScopedSql, row: ConnectRow, action: 'payment_method.connect_approved' | 'payment_method.connect_failed', reason: string | null) =>
    activity.record(tx, {
      category: 'system',
      action,
      result: action === 'payment_method.connect_approved' ? 'success' : 'failed',
      actorKind: 'provider',
      actorId: 'stripe',
      actorLabel: 'Stripe',
      partnerId: row.partner_id,
      storeId: row.store_id,
      target: { type: 'payment_method', id: 'stripe', label: 'Stripe' },
      reason,
      api: 'system',
      requestId: null,
      ip: null,
      userAgent: null,
      visibility: 'store',
    })
  const fail = async (reason: 'declined' | 'exchange_failed') => {
    await withSystemScope(sql, async (tx) => {
      await deleteConnect(tx, pending.id)
      await record(tx, pending, 'payment_method.connect_failed', reason)
    })
    return back(pending.return_host, reason === 'declined' ? 'stripe=cancelled' : 'stripe=failed')
  }
  // The merchant pressed "Cancel" on Stripe, or Stripe refused the request.
  if (query.get('error') || !query.get('code')) return fail('declined')
  let accountId: string
  try {
    accountId = (await connect.exchange(query.get('code') ?? '')).accountId
  } catch (error) {
    logEvent({ event: 'stripe_connect_exchange_failed', api: 'hooks', storeId: pending.store_id, code: error instanceof Error ? error.name : 'unknown' })
    return fail('exchange_failed')
  }
  const key = newSessionId()
  const approved = await withSystemScope(sql, async (tx) => {
    const done = await approveConnect(tx, pending.id, { accountId, finishHash: await hashSessionId(key), expiresAt: new Date(now().getTime() + finishConnectMs) })
    if (done) await record(tx, pending, 'payment_method.connect_approved', null)
    return done
  })
  return back(pending.return_host, approved ? `stripe=finish&key=${key}` : 'stripe=failed')
}
