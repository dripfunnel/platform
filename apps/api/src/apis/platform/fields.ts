import { unauthenticated } from '../graphql/scope'
import { builder } from './builder'

/** A field's service, present only for a signed-in partner user. */
export const signedIn = <T>(service: T | null): T => {
  if (!service) throw unauthenticated()
  return service
}

/** An input object without the fields GraphQL sent as null, for a strict zod schema. */
export const present = (o: Record<string, unknown> | null | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined))

export const partnerRead = { api: 'platform', scope: 'partner', permission: 'partner.read', target: 'none' } as const

/** What asking for an export answers: the job's id, or the refusal's reason. */
export const exportResultType = (name: string) =>
  builder.objectRef<{ ok: boolean; jobId?: string; reason?: string }>(name).implement({
    fields: (t) => ({
      ok: t.exposeBoolean('ok'),
      jobId: t.string({ nullable: true, resolve: (r) => r.jobId ?? null }),
      reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
    }),
  })
