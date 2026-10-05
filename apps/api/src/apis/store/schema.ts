import { secureSchema } from '../graphql/scope'
import { storePolicy } from './access'
import { createStoreBuilder } from './builder'
import { registerPeople } from './people'
import { registerProfile } from './profile'
import { registerShell } from './shell'

export type { StoreContext } from './access'

const builder = createStoreBuilder()
builder.mutationType({})

builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'store', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))
registerShell(builder)
registerProfile(builder)
registerPeople(builder)

export const storeSchema = secureSchema(builder.toSchema(), storePolicy)
