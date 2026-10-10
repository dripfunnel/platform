import { secureSchema } from '../graphql/scope'
import { shopPolicy } from './access'
import { createShopBuilder } from './builder'
import { registerCatalog } from './catalog'
import { registerProducts } from './products'
import { registerCart } from './cart'
import { registerReminderLinks } from './reminders'
import { registerAccounts } from './accounts'
import { registerCheckout } from './checkout'

export type { ShopContext } from './access'

const shop = createShopBuilder()
shop.builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'shop', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))
registerCatalog(shop)
registerProducts(shop)
shop.builder.mutationType({})
const { Cart } = registerCart(shop)
registerReminderLinks(shop, Cart)
registerAccounts(shop)
registerCheckout(shop)

export const shopSchema = secureSchema(shop.builder.toSchema(), shopPolicy)
