import { describe, expect, it } from 'vitest'
import { StripeRefused, StripeUnavailable } from './api'
import { stripeConnect } from './connect'

describe('Stripe Connect OAuth', () => {
  it('sends the merchant to Stripe with the platform’s id, the state and the one registered redirect', () => {
    const url = new URL(stripeConnect({ clientId: 'ca_123', secretKey: 'sk_test_x', redirectUri: 'https://hooks.example/stripe/connect/callback' }).authorizeUrl('abc'))
    expect(url.origin + url.pathname).toBe('https://connect.stripe.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'ca_123', scope: 'read_write', state: 'abc', redirect_uri: 'https://hooks.example/stripe/connect/callback' })
  })

  it('turns the code into the account’s id and keeps no token; refused and down are told apart', async () => {
    let body = ''
    const connect = stripeConnect({
      clientId: 'ca_123',
      secretKey: 'sk_test_x',
      redirectUri: 'https://h/cb',
      fetchImpl: async (_, init) => {
        body = String(init?.body)
        return Response.json({ access_token: 'sk_never_kept', stripe_user_id: 'acct_merchant', livemode: false, scope: 'read_write' })
      },
    })
    expect(await connect.exchange('ac_code')).toEqual({ accountId: 'acct_merchant', livemode: false })
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({ grant_type: 'authorization_code', code: 'ac_code' })
    const refusing = stripeConnect({ clientId: 'ca', secretKey: 'k', redirectUri: 'r', fetchImpl: async () => Response.json({ error: 'invalid_grant' }, { status: 400 }) })
    await expect(refusing.exchange('used')).rejects.toBeInstanceOf(StripeRefused)
    const down = stripeConnect({ clientId: 'ca', secretKey: 'k', redirectUri: 'r', fetchImpl: async () => new Response('', { status: 502 }) })
    await expect(down.exchange('c')).rejects.toBeInstanceOf(StripeUnavailable)
  })

  it('ends the platform’s access on Disconnect, and an account already gone is no error', async () => {
    let body = ''
    await stripeConnect({ clientId: 'ca_1', secretKey: 'k', redirectUri: 'r', fetchImpl: async (_, init) => ((body = String(init?.body)), Response.json({ stripe_user_id: 'acct_1' })) }).deauthorize('acct_1')
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({ client_id: 'ca_1', stripe_user_id: 'acct_1' })
    await expect(stripeConnect({ clientId: 'ca', secretKey: 'k', redirectUri: 'r', fetchImpl: async () => Response.json({ error: 'invalid_client' }, { status: 401 }) }).deauthorize('acct_1')).resolves.toBeUndefined()
  })
})
