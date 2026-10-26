import { readFileSync } from 'node:fs'
import { printSchema, type GraphQLSchema } from 'graphql'
import { describe, expect, it } from 'vitest'
import { adminSchema } from '#apis/admin/schema'
import { deliverySchema } from '#apis/delivery/schema'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'

// The SPAs are written against apps/api/schema/*.graphql (AGENTS.md "Where things go"): a field added without
// `pnpm --filter ./apps/api schema` fails here instead of reaching a screen unseen.
const schemas: Record<string, GraphQLSchema> = { store: storeSchema, admin: adminSchema, platform: platformSchema, shop: shopSchema, delivery: deliverySchema }

describe('the committed schema files', () => {
  it.each(Object.keys(schemas))('match the %s API as built', (name) => {
    // Git checks the file out with CRLF on Windows.
    const committed = readFileSync(new URL(`../../schema/${name}.graphql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
    expect(committed).toBe(`${printSchema(schemas[name] as GraphQLSchema)}\n`)
  })
})
