import { secureSchema } from '../graphql/scope'
import { storePolicy } from './access'
import { createStoreBuilder } from './builder'
import { registerListing } from './listing'
import { registerPeople } from './people'
import { registerProducts } from './products'
import { registerProductKinds } from './productKinds'
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
import { registerShipping } from './shipping'
import { registerCustomerAccounts } from './customerAccounts'
import { registerPayments } from './payments'
import { registerOrders } from './orders'
import { registerCustomers } from './customers'
import { registerHome } from './home'
import { registerReports } from './reports'
import { registerReportExports } from './reportExports'
import { registerOffers } from './offers'
import { registerCartReminders } from './cartReminders'
import { registerCatalogExports } from './catalogExports'
import { registerCatalogImports } from './catalogImports'
import { registerShopify } from './shopify'
import { registerBilling } from './billing'

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
registerProductKinds(builder)
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
registerShipping(builder)
registerCustomerAccounts(builder)
registerPayments(builder)
registerOrders(builder)
registerCustomers(builder)
registerOffers(builder)
registerCartReminders(builder)
registerHome(builder)
registerReports(builder)
registerReportExports(builder)
registerListing(builder)
registerBilling(builder)

export const storeSchema = secureSchema(builder.toSchema(), storePolicy)
