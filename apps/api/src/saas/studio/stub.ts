import type { TenantContext } from '#core/tenancy'

/** The store's StudioSession, named by the session's TenantContext, never by a store id from the request (AI-STUDIO §3 step 2). */
export const studioOf = <T extends Rpc.DurableObjectBranded | undefined>(namespace: DurableObjectNamespace<T>, context: TenantContext): DurableObjectStub<T> =>
  namespace.get(namespace.idFromName(context.storeId))

/** The store's StudioSession for the platform's own jobs (the upgrade bot), by a store id read from the database. */
export const studioForJob = <T extends Rpc.DurableObjectBranded | undefined>(namespace: DurableObjectNamespace<T>, storeId: string): DurableObjectStub<T> =>
  namespace.get(namespace.idFromName(storeId))
