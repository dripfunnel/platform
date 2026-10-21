import { isObjectType } from 'graphql'
import { describe, expect, it } from 'vitest'
import { machineScopes } from '#auth/apiKeys'
import { storeSchema } from './schema'

// ACCESS.md §5.6: a key is granted only scopes some field open to keys uses, and every such field uses one of them.
describe('fields open to API keys', () => {
  const open = Object.values(storeSchema.getTypeMap())
    .filter(isObjectType)
    .flatMap((type) => Object.values(type.getFields()).map((field) => ({ where: `${type.name}.${field.name}`, access: field.extensions.access })))
    .filter((f) => f.access?.machine)

  it('use exactly the scopes a key can be given', () => {
    expect([...new Set(open.map((f) => f.access?.permission))].sort()).toEqual([...machineScopes].sort())
  })

  it('are reads only, until a card opens a write with the key recorded as its actor (LOGGING.md §4)', () => {
    const writes = Object.keys(storeSchema.getMutationType()?.getFields() ?? {}).map((name) => `Mutation.${name}`)
    expect(open.map((f) => f.where).filter((w) => writes.includes(w))).toEqual([])
  })
})
