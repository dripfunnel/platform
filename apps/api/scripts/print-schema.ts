import { writeFileSync } from 'node:fs'
import { printSchema, type GraphQLSchema } from 'graphql'
import { adminSchema } from '#apis/admin/schema'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'

const schemas: Record<string, GraphQLSchema> = { store: storeSchema, admin: adminSchema, platform: platformSchema, shop: shopSchema }

for (const [name, schema] of Object.entries(schemas)) {
  writeFileSync(new URL(`../schema/${name}.graphql`, import.meta.url), `${printSchema(schema)}\n`)
}
