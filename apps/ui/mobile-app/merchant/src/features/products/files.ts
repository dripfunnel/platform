import type { PhotoDeps } from '../../api/products'
import { authHeaders, partnerDomain } from '../../graphql'
import { session } from '../../session'

/** The host and the session's headers a stored file is read and written with; read afresh on each use, as the client's are. */
export const fileDeps = (): PhotoDeps => ({
  domain: partnerDomain(),
  headers: () => authHeaders({ token: () => session().token(), store: () => session().acting()?.storeId ?? null, supplier: () => session().acting()?.supplierId ?? null }),
})
