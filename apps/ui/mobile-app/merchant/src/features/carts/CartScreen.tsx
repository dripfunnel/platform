import { t } from '../../messages'
import { CartPage } from './CartPage'
import { CartsGate } from './CartsGate'

// One cart by id (`/more/carts/<id>`): the gate reads the seat's permissions first, so a supplier is access denied before a cart is asked for.
export function CartScreen({ id }: { id: string }) {
  return <CartsGate label={t('carts.detail.screen')}>{(access, client) => <CartPage client={client} id={id} access={access} />}</CartsGate>
}
