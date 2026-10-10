import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { suppressedAmong } from '#db/scoped/emailSuppression'
import { withSystemScope } from '#db/scoped/index'
import { SesRefused, type SesApi } from '#integrations/ses/index'
import { en, fromAddress, prepareEmail, renderEmail, type EmailHosts } from '#saas/email/index'
import type { Deliverer } from '../outbox-relay'

export interface EmailDelivererOptions {
  hosts: EmailHosts
  /** The verified SES domain DripFunnel and the partners' fallback senders send from (SAAS §3.6). */
  senderDomain: string
  /** EMAIL_SUPPRESSION_KEY, which keys the suppression list's hashes. */
  suppressionKey: string
  now?: () => Date
}

/**
 * `email`: one outbox row, one message through SES (THIRD-PARTY-ACCESS §2.4). The link is minted
 * and the message sent in one transaction, so a failed send rolls the link back and the relay's
 * retry mints it again. SES has no idempotency key: a crash after SES accepts and before the row
 * is marked delivered can send it twice, the outbox's at-least-once.
 */
/** Thrown to roll back what composing wrote when the message won't go: a suppressed gift card recipient keeps an unsent card. */
class SkippedUnsent extends Error {}

export const emailDeliverer = (sql: postgres.Sql, ses: SesApi, { hosts, senderDomain, suppressionKey, now = () => new Date() }: EmailDelivererOptions): Deliverer => ({
  deliver: async (effect, signal) => {
    const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
    await withSystemScope(sql, async (tx) => {
      const prepared = await prepareEmail(tx, { payload: effect.payload, partnerId: effect.partnerId, storeId: effect.storeId }, hosts, now())
      if (!prepared.send) return log('email_skipped', prepared.reason)
      // Account security goes out regardless: an invitation or reset that never arrives locks someone out.
      const suppressed = prepared.accountSecurity ? new Set<string>() : await suppressedAmong(tx, suppressionKey, prepared.to)
      const to = prepared.to.filter((address) => !suppressed.has(address))
      if (to.length === 0) {
        if (prepared.keptOnlyIfSent) throw new SkippedUnsent()
        return log('email_skipped', 'suppressed')
      }
      const rendered = renderEmail(prepared.brand, prepared.content, en.footer)
      try {
        await ses.send({ from: fromAddress(prepared.voice, prepared.brand, senderDomain), to, ...rendered, tags: { outbox: effect.id } }, signal)
      } catch (error) {
        // SES's own code (e.g. MessageRejected for an unverified sandbox recipient) is safe to log; its message is not.
        if (error instanceof SesRefused) log('email_refused', error.code)
        throw error
      }
      log('email_sent', 'sent')
    }).catch((error: unknown) => {
      if (!(error instanceof SkippedUnsent)) throw error
      log('email_skipped', 'suppressed')
    })
  },
})
