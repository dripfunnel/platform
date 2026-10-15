import { t } from '../../messages'
import { CustomerPage } from './CustomerPage'
import { CustomersGate } from './CustomersGate'

// One customer by id (`/more/customers/<id>`): the gate reads the seat's permissions first, so a supplier is access denied before a customer is asked for.
export function CustomerScreen({ id }: { id: string }) {
  return <CustomersGate label={t('customers.detail.screen')}>{(access, client) => <CustomerPage client={client} id={id} access={access} />}</CustomersGate>
}
