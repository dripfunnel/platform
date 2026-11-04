import { secureSchema } from '../graphql/scope'
import { shopPolicy } from './access'
import { createShopBuilder } from './builder'
import { registerCatalog } from './catalog'
import { registerProducts } from './products'
import { registerContent } from './content'
import { registerCart } from './cart'
import { registerReminderLinks } from './reminders'
import { registerAccounts } from './accounts'
import { registerWishlist } from './wishlist'
import { registerCheckout } from './checkout'
import { registerOffers } from './offers'

export type { ShopContext } from './access'

const shop = createShopBuilder()
shop.builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'shop', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))
registerCatalog(shop)
const { Summary } = registerProducts(shop)
registerContent(shop)
registerOffers(shop)
shop.builder.mutationType({})
const { Cart } = registerCart(shop)
registerReminderLinks(shop, Cart)
registerAccounts(shop)
registerWishlist(shop, Summary)
registerCheckout(shop)

export const shopSchema = secureSchema(shop.builder.toSchema(), shopPolicy)
