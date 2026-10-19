import { t } from '../../messages'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { isOwner } from './access'
import { AccountsTab } from './accounts/AccountsTab'
import { CatalogueTab } from './catalogue/CatalogueTab'
import { DevelopersTab } from './developers/DevelopersTab'
import { MarketsTab } from './markets/MarketsTab'
import { PaymentsTab } from './payments/PaymentsTab'
import { PeopleTab } from './people/PeopleTab'
import { ShippingTab } from './shipping/ShippingTab'
import { StoreInfoTab } from './store/StoreInfoTab'
import { SuppliersTab } from './suppliers/SuppliersTab'
import { TaxTab } from './tax/TaxTab'
import { WarehouseTab } from './warehouse/WarehouseTab'
import { isSettingsTab } from './tabs'

// One Settings tab on its own screen. A deep link from anyone but the Owner is access denied before anything is read. The API refuses every write to a
// non-Owner but not every read, so this is the only guard on those (access.ts). A tab this release doesn't have is the shell's 404.
export function SettingsTabScreen({ tab }: { tab: string }) {
  const { seat } = useShell()
  if (!isOwner(seat)) return <ShellScreen label={t('settings.screen')} state="denied">{null}</ShellScreen>
  if (!isSettingsTab(tab)) return <ShellScreen label={t('settings.screen')} state="notFound">{null}</ShellScreen>
  switch (tab) {
    case 'store':
      return <StoreInfoTab />
    case 'people':
      return <PeopleTab />
    case 'suppliers':
      return <SuppliersTab />
    case 'payments':
      return <PaymentsTab />
    case 'shipping':
      return <ShippingTab />
    case 'warehouse':
      return <WarehouseTab />
    case 'tax':
      return <TaxTab />
    case 'markets':
      return <MarketsTab />
    case 'catalogue':
      return <CatalogueTab />
    case 'accounts':
      return <AccountsTab />
    case 'developers':
      return <DevelopersTab />
  }
}
