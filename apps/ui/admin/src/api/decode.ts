import { z } from 'zod'
import type { ActionPermission } from './permissions'

// Pieces of the generated schema that several areas share (apps/api/schema/admin.graphql).

export const isoString = z.string().min(1)

export const pageInfoSchema = z.object({
  startCursor: z.string().nullable(),
  endCursor: z.string().nullable(),
  hasPreviousPage: z.boolean(),
  hasNextPage: z.boolean(),
})

export const refSchema = z.object({ id: z.string(), name: z.string() })

// `ActionPermission` on the wire: the stable codes are those the API declares for the area,
// so a code it has never promised fails the decode instead of reaching a screen unworded.
export const permissionSchema = <Code extends string>(codes: readonly [Code, ...Code[]]) =>
  z
    .object({ allowed: z.boolean(), reason: z.string().nullable(), failingChecks: z.array(z.string()).nullable() })
    .transform((p, ctx): ActionPermission<Code> => {
      if (p.allowed) return { allowed: true }
      const reason = z.enum(codes).safeParse(p.reason)
      if (!reason.success) {
        ctx.addIssue({ code: 'custom', message: `unknown refusal ${p.reason ?? 'null'}` })
        return z.NEVER
      }
      return { allowed: false, reason: reason.data }
    })

// An actions block as the screens read it: the actions the record offers, nothing for the rest.
export const compactActions = <T extends Record<string, unknown>>(actions: T): { [K in keyof T]?: NonNullable<T[K]> } =>
  Object.fromEntries(Object.entries(actions).filter(([, value]) => value !== null)) as { [K in keyof T]?: NonNullable<T[K]> }

// The host statuses SAAS.md §3.5 and §8 give a domain, plus `notSet` for a partner without one.
export const hostStatuses = ['waiting', 'verifying', 'issuing', 'live', 'failed', 'expiring', 'broken', 'notSet'] as const
export type HostStatus = (typeof hostStatuses)[number]
export const hostStatusSchema = z.enum(hostStatuses)

// A filter as the API's input type declares it: a key the address carried for something else
// (?state=, the harness's) would be refused as an unknown field.
export const filterOf = <Filter extends object, Key extends keyof Filter>(filter: Filter, keys: readonly Key[]): Partial<Pick<Filter, Key>> =>
  Object.fromEntries(keys.flatMap((key) => (filter[key] === undefined ? [] : [[key, filter[key]]]))) as Partial<Pick<Filter, Key>>
