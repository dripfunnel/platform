import { secureSchema } from '../graphql/scope'
import { shopPolicy } from './access'
import { createShopBuilder } from './builder'
import { registerCatalog } from './catalog'

export type { ShopContext } from './access'

const shop = createShopBuilder()
shop.builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'shop', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))
registerCatalog(shop)

export const shopSchema = secureSchema(shop.builder.toSchema(), shopPolicy)
