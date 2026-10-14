import type { PhotoDeps } from '../../api/products'
import { partnerDomain } from '../../graphql'
import { session } from '../../session'

/** The host and the session's headers a stored file is read and written with; read afresh on each use, as the client's are. */
export const fileDeps = (): PhotoDeps => ({
  domain: partnerDomain(),
  headers: () => {
    const token = session().token()
    const acting = session().acting()
    return {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(acting ? { 'x-store': acting.storeId } : {}),
      ...(acting?.supplierId ? { 'x-supplier': acting.supplierId } : {}),
    }
  },
})
