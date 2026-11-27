import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Billing › Razorpay account (#1744): the partner's own keys its merchants pay their plan with, live and test. A key comes
// back as "rzp_live_••••AbCd"; the secrets go up once and are never read back.

const modeSchema = z.enum(['live', 'test'])
export type RazorpayMode = z.infer<typeof modeSchema>
const accountSchema = z.object({
  webhookUrl: z.string(),
  modes: z.array(z.object({ mode: modeSchema, connected: z.boolean(), keyHint: z.string().nullable(), checkedAt: z.string().nullable() })),
})
export type RazorpayAccount = z.infer<typeof accountSchema>

export const razorpayRefusals = ['INVALID_INPUT', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND'] as const
export type RazorpayRefusal = (typeof razorpayRefusals)[number]
export type RazorpayResult = { ok: true } | { ok: false; reason: RazorpayRefusal }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable() })
const resultOf = (r: z.infer<typeof resultSchema>): RazorpayResult => {
  if (r.ok) return { ok: true }
  const known = razorpayRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known }
}

export const loadRazorpay = async (): Promise<RazorpayAccount> =>
  (await query('{ razorpayAccount { webhookUrl modes { mode connected keyHint checkedAt } } }', z.object({ razorpayAccount: accountSchema }))).razorpayAccount

export const connectRazorpay = async (mode: RazorpayMode, keys: { keyId: string; keySecret: string; webhookSecret: string }): Promise<RazorpayResult> =>
  resultOf(
    (
      await query(
        'mutation Connect($mode: String!, $keyId: String!, $keySecret: String!, $webhookSecret: String!) { connectRazorpay(mode: $mode, keyId: $keyId, keySecret: $keySecret, webhookSecret: $webhookSecret) { ok reason } }',
        z.object({ connectRazorpay: resultSchema }),
        { mode, ...keys },
      )
    ).connectRazorpay,
  )

export const disconnectRazorpay = async (mode: RazorpayMode): Promise<RazorpayResult> =>
  resultOf((await query('mutation Disconnect($mode: String!) { disconnectRazorpay(mode: $mode) { ok reason } }', z.object({ disconnectRazorpay: resultSchema }), { mode })).disconnectRazorpay)
