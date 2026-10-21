import SchemaBuilder from '@pothos/core'
import type { AdminContext } from './access'

/** One builder for the Admin API; each area file adds its types and fields to it (api/README.md §3). */
export const builder = new SchemaBuilder<{ Context: AdminContext }>({})

builder.queryType({})
