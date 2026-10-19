import { t } from '../../messages'
import { OffersGate } from './OffersGate'
import { OffersHome } from './OffersHome'

// The Offers tab: the gate reads the seat's permissions, so a supplier is access denied before anything is asked.
export function OffersScreen() {
  return <OffersGate label={t('offers.screen')}>{(access, client) => <OffersHome access={access} client={client} />}</OffersGate>
}
