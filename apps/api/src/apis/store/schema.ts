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
import { registerSuppliers } from './suppliers'
import { registerSupplierTeam } from './supplierTeam'
import { registerApproval } from './approval'
import { registerMarkets } from './markets'
import { registerTranslations } from './translations'
import { registerStoreInfo } from './storeInfo'
import { registerTax } from './tax'
import { registerCatalogExports } from './catalogExports'
import { registerCatalogImports } from './catalogImports'
import { registerShopify } from './shopify'

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
registerSuppliers(builder)
registerSupplierTeam(builder)
registerApproval(builder)
registerMarkets(builder)
registerTranslations(builder)
registerStoreInfo(builder)
registerCatalogExports(builder)
registerCatalogImports(builder)
registerShopify(builder)
registerTax(builder)
registerListing(builder)

export const storeSchema = secureSchema(builder.toSchema(), storePolicy)
