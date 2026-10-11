import type { TenantContext } from '#core/tenancy'

/** The store's StudioSession, named by the session's TenantContext, never by a store id from the request (AI-STUDIO §3 step 2). */
export const studioOf = <T extends Rpc.DurableObjectBranded | undefined>(namespace: DurableObjectNamespace<T>, context: TenantContext): DurableObjectStub<T> =>
  namespace.get(namespace.idFromName(context.storeId))
