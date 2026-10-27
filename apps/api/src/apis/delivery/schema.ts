import { registerCarry } from './carry'
import { registerDispatch } from './dispatch'
import { secureSchema } from '../graphql/scope'
import { deliveryPolicy } from './access'
import { registerAccount } from './account'
import { createDeliveryBuilder } from './builder'
import { registerDevices } from './devices'

export type { DeliveryContext } from './access'

const builder = createDeliveryBuilder()
builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'delivery', scope: 'public', permission: null } }, resolve: () => 'ok' }),
}))
registerAccount(builder)
registerDevices(builder)
registerDispatch(builder)
registerCarry(builder)

export const deliverySchema = secureSchema(builder.toSchema(), deliveryPolicy)
