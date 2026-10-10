import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planGroups, planKeyDefs } from './planKeys'

// The console's list mirrors apps/api/src/db/scoped/planKeys.ts; the console can't import the API,
// so this reads the API's file and compares each row.
describe('plan keys', () => {
  const api = readFileSync(new URL('../../../../api/src/db/scoped/planKeys.ts', import.meta.url), 'utf8')
  const rows = [...api.matchAll(/\b(sw|amount|choice)\('([a-z_]+)', '([a-z]+)'(?:, (true|false))?(?:, (true))?(?:, (\[[^\]]*\]))?(?:, (true))?/g)]
  // A choice names its choices first and whether it is enforced after them.
  const enforced = (m: RegExpMatchArray) => (m[1] === 'choice' ? m[7] === 'true' : m[4] === 'true')

  it('lists the same keys, kinds and groups as the API, in the same order', () => {
    const kind = { sw: 'switch', amount: 'amount', choice: 'choice' } as const
    expect(planKeyDefs.map((d) => [d.key, d.kind, d.group])).toEqual(rows.map((m) => [m[2], kind[m[1] as keyof typeof kind], m[3]]))
  })

  it('agrees on which rows are enforced and which are monthly', () => {
    expect(planKeyDefs.filter((d) => d.enforced).map((d) => d.key)).toEqual(rows.filter(enforced).map((m) => m[2]))
    expect(planKeyDefs.filter((d) => d.monthly).map((d) => d.key)).toEqual(rows.filter((m) => m[5] === 'true').map((m) => m[2]))
  })

  it('uses only the API’s groups', () => {
    expect(api).toContain(`planGroups = [${planGroups.map((g) => `'${g}'`).join(', ')}]`)
  })
})
