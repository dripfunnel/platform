import { registerCarry } from './carry'
import { registerDispatch } from './dispatch'
import { secureSchema } from '../graphql/scope'
import { withSystemScope } from '#db/scoped/index'
import { selectLatestDeliveryApp } from '#db/scoped/storeDeliveryApp'
import { deliveryPolicy, storeOf } from './access'
import { registerAccount } from './account'
import { createDeliveryBuilder } from './builder'
import { registerDevices } from './devices'

export type { DeliveryContext } from './access'

const builder = createDeliveryBuilder()
builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'delivery', scope: 'public', permission: null } }, resolve: () => 'ok' }),
  // The build below which the app says "Update required"; null when staff set none (DELIVERY §5).
  minimumBuild: t.int({
    nullable: true,
    extensions: { access: { api: 'delivery', scope: 'public', permission: null } },
    resolve: async (_, __, ctx) => {
      const { sql, caller } = storeOf(ctx)
      return (await withSystemScope(sql, (tx) => selectLatestDeliveryApp(tx, caller.storeId)))?.minimum_build ?? null
    },
  }),
}))
registerAccount(builder)
registerDevices(builder)
registerDispatch(builder)
registerCarry(builder)

export const deliverySchema = secureSchema(builder.toSchema(), deliveryPolicy)
