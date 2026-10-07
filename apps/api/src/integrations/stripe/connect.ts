import { z } from 'zod'
import type { OAuthConnect } from '#core/payments'
import { stripeTimeoutMs, StripeRefused, StripeUnavailable } from './api'

// Stripe Connect Standard by OAuth (THIRD-PARTY-ACCESS §3.1, decided 2026-10-05 on #284): the merchant approves on
// Stripe, which returns to the hooks host; the code becomes the connected account's id. No token is kept: the platform's
// own key acts on the account by its id.

const connectBase = 'https://connect.stripe.com'

const tokenSchema = z.object({ stripe_user_id: z.string().regex(/^acct_[A-Za-z0-9]+$/), livemode: z.boolean() }).loose()

export const stripeConnect = ({ clientId, secretKey, redirectUri, fetchImpl = fetch }: { clientId: string; secretKey: string; redirectUri: string; fetchImpl?: typeof fetch }): OAuthConnect => {
  const post = async (path: string, form: Record<string, string>): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(`${connectBase}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(stripeTimeoutMs),
      })
    } catch {
      throw new StripeUnavailable('no answer')
    }
    if (response.status >= 500 || response.status === 429) throw new StripeUnavailable(`answered ${response.status}`)
    const json: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const code = z.object({ error: z.string().max(100) }).safeParse(json)
      throw new StripeRefused(code.success ? code.data.error : `answered ${response.status}`)
    }
    return json
  }

  return {
    authorizeUrl: (state) =>
      `${connectBase}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'read_write', state, redirect_uri: redirectUri }).toString()}`,
    exchange: async (code) => {
      const parsed = tokenSchema.safeParse(await post('/oauth/token', { grant_type: 'authorization_code', code }))
      if (!parsed.success) throw new StripeUnavailable('answered in a shape we do not read')
      return { accountId: parsed.data.stripe_user_id, livemode: parsed.data.livemode }
    },
    deauthorize: async (accountId) => {
      try {
        await post('/oauth/deauthorize', { client_id: clientId, stripe_user_id: accountId })
      } catch (error) {
        // Already disconnected on Stripe's side: what Disconnect wanted.
        if (!(error instanceof StripeRefused)) throw error
      }
    },
  }
}
