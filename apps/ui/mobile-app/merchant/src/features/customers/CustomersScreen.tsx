import { t } from '../../messages'
import { CustomersGate } from './CustomersGate'
import { CustomersHome } from './CustomersHome'

// More › Customers (FIRST-RELEASE (store) §7): the gate reads the seat's permissions, so a supplier is access denied before anything is asked.
export function CustomersScreen() {
  return <CustomersGate label={t('customers.screen')}>{(access, client) => <CustomersHome access={access} client={client} />}</CustomersGate>
}
