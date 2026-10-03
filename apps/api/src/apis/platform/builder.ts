import SchemaBuilder from '@pothos/core'
import type { PlatformContext } from './access'

/** One builder for the Platform API; each area file adds its types and fields to it (api/README.md §3). */
export const builder = new SchemaBuilder<{ Context: PlatformContext }>({})

builder.queryType({})
