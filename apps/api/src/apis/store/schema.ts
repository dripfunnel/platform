import { secureSchema } from '../graphql/scope'
import { storePolicy } from './access'
import { createStoreBuilder } from './builder'
import { registerListing } from './listing'
import { registerPeople } from './people'
import { registerProducts } from './products'
import { registerProfile } from './profile'
import { registerShell } from './shell'
import { registerStructure } from './structure'
import { registerStory } from './story'
import { registerInventory } from './inventory'

export type { StoreContext } from './access'

const builder = createStoreBuilder()
builder.mutationType({})

builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'store', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))
registerShell(builder)
registerProfile(builder)
registerPeople(builder)
registerProducts(builder)
registerStructure(builder)
registerStory(builder)
registerInventory(builder)
registerListing(builder)

export const storeSchema = secureSchema(builder.toSchema(), storePolicy)
