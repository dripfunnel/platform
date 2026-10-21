import SchemaBuilder from '@pothos/core'
import { GraphQLError } from 'graphql'
import type { PlatformContext } from './access'

/** One builder for the Platform API; each area file adds its types and fields to it (api/README.md §3). */
export const builder = new SchemaBuilder<{ Context: PlatformContext; Scalars: { MinorUnits: { Input: number; Output: number } } }>({})

builder.queryType({})

// Money's amount: an integer in minor units, past GraphQL's 32-bit Int but never a fraction.
const minorUnits = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new GraphQLError('An amount is a whole number of minor units.', { extensions: { code: 'INVALID_INPUT' } })
  return value
}

builder.scalarType('MinorUnits', { serialize: minorUnits, parseValue: minorUnits })
