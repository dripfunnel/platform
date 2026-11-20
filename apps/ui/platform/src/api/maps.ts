import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations, Google Maps (#1614 on #1612's API): the partner's own browser key and whose key its stores' maps use.
// The key comes back as "AIza…abcd".

const whose = z.enum(['own', 'dripfunnel'])
const statusSchema = z.object({
  key: z.object({ hint: z.string(), status: z.enum(['untested', 'ok', 'rejected']), lastTestedAt: z.string().nullable() }).nullable(),
  // DripFunnel's key is there for the partner: Admin let it use it and it is Working.
  dripfunnel: z.boolean(),
  choice: whose.nullable(),
  // Whose key the stores' maps use now; null where none is usable, so no map is drawn.
  sender: whose.nullable(),
})
export type MapsStatus = z.infer<typeof statusSchema>
export type MapsKey = NonNullable<MapsStatus['key']>
export type MapsChoice = z.infer<typeof whose>

export const mapsRefusals = ['INVALID_INPUT', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND', 'DRIPFUNNEL_UNAVAILABLE', 'NO_KEY'] as const
export type MapsRefusal = (typeof mapsRefusals)[number]
/** What Google refused. */
export const mapsProblems = ['invalid', 'geocoding_disabled', 'restricted', 'other'] as const
export type MapsProblem = (typeof mapsProblems)[number]
export type MapsResult = { ok: true; status: 'ok' | 'rejected' | null; problem: MapsProblem | null } | { ok: false; reason: MapsRefusal; problem: MapsProblem | null }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), status: z.string().nullable(), problem: z.string().nullable() })
const fields = 'ok reason status problem'

const resultOf = (r: z.infer<typeof resultSchema> | undefined, field: string): MapsResult => {
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  const problem = mapsProblems.find((p) => p === r.problem) ?? null
  if (r.ok) return { ok: true, status: r.status === 'ok' || r.status === 'rejected' ? r.status : null, problem }
  const known = mapsRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known, problem }
}

export const loadMaps = async (): Promise<MapsStatus> =>
  (await query(`{ mapsKey { dripfunnel choice sender key { hint status lastTestedAt } } }`, z.object({ mapsKey: statusSchema }))).mapsKey

export const saveMaps = async (key: string): Promise<MapsResult> =>
  resultOf((await query(`mutation Save($key: String!) { saveMapsKey(key: $key) { ${fields} } }`, z.object({ saveMapsKey: resultSchema }), { key })).saveMapsKey, 'saveMapsKey')

export const testMaps = async (): Promise<MapsResult> => resultOf((await query(`mutation { testMapsKey { ${fields} } }`, z.object({ testMapsKey: resultSchema }))).testMapsKey, 'testMapsKey')

export const removeMaps = async (): Promise<MapsResult> => resultOf((await query(`mutation { removeMapsKey { ${fields} } }`, z.object({ removeMapsKey: resultSchema }))).removeMapsKey, 'removeMapsKey')

export const setMapsChoice = async (account: MapsChoice): Promise<MapsResult> =>
  resultOf((await query(`mutation Choose($account: String!) { setMapsChoice(account: $account) { ${fields} } }`, z.object({ setMapsChoice: resultSchema }), { account })).setMapsChoice, 'setMapsChoice')
