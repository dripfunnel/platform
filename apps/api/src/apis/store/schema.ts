import { secureSchema } from '../graphql/scope'
import { storePolicy } from './access'
import { createStoreBuilder } from './builder'

export type { StoreContext } from './access'

const builder = createStoreBuilder()

builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'store', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))

export const storeSchema = secureSchema(builder.toSchema(), storePolicy)
