import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// My profile (#1053): the signed-in user's own name and password on the Platform API.
export const profileRefusals = ['INVALID_INPUT', 'WEAK_PASSWORD', 'WRONG_PASSWORD', 'LOCKED', 'NOT_FOUND'] as const
export type ProfileRefusal = (typeof profileRefusals)[number]
export type ProfileResult = { ok: true } | { ok: false; reason: ProfileRefusal; triesLeft: number | null; minutes: number | null }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), triesLeft: z.number().int().nullable(), minutes: z.number().int().nullable() })

const resultOf = (r: z.infer<typeof resultSchema>): ProfileResult => {
  if (r.ok) return { ok: true }
  const reason = profileRefusals.find((code) => code === r.reason)
  if (!reason) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason, triesLeft: r.triesLeft, minutes: r.minutes }
}

export const updateMyName = async (name: string): Promise<ProfileResult> =>
  resultOf((await query(`mutation Name($name: String!) { updateMyName(name: $name) { ok reason triesLeft minutes } }`, z.object({ updateMyName: resultSchema }), { name })).updateMyName)

export const changeMyPassword = async (current: string, password: string): Promise<ProfileResult> =>
  resultOf(
    (await query(`mutation Password($current: String!, $password: String!) { changeMyPassword(current: $current, password: $password) { ok reason triesLeft minutes } }`, z.object({ changeMyPassword: resultSchema }), { current, password }))
      .changeMyPassword,
  )
