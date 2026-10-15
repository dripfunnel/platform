import { t } from '../../messages'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { isOwner } from './access'
import { StoreInfoTab } from './store/StoreInfoTab'
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
  }
}
