import type { TenantContext } from '#core/tenancy'

/** AI-STUDIO §9 "Placement": made in Asia Pacific, beside the containers it starts (#1241); a hint counts only at creation. */
export const studioLocation = { locationHint: 'apac' } as const

type Namespace<Id, Stub> = { idFromName: (name: string) => Id; get: (id: Id, options: typeof studioLocation) => Stub }

/** The store's StudioSession, named by the session's TenantContext, never by a store id from the request (AI-STUDIO §3 step 2). */
export const studioOf = <Id, Stub>(namespace: Namespace<Id, Stub>, context: TenantContext): Stub => namespace.get(namespace.idFromName(context.storeId), studioLocation)

/** The store's StudioSession for the platform's own jobs and the frame's host, by a store id read from the database or the host. */
export const studioForJob = <Id, Stub>(namespace: Namespace<Id, Stub>, storeId: string): Stub => namespace.get(namespace.idFromName(storeId), studioLocation)
