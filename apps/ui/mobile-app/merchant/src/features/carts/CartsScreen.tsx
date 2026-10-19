import { t } from '../../messages'
import { CartsGate } from './CartsGate'
import { CartsHome } from './CartsHome'

// More › Abandoned carts (FIRST-RELEASE (store) §9): the gate reads the seat's permissions, so a supplier is access denied before anything is asked.
export function CartsScreen() {
  return <CartsGate label={t('carts.screen')}>{(access, client) => <CartsHome access={access} client={client} />}</CartsGate>
}
