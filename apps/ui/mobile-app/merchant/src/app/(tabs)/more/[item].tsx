import { useLocalSearchParams } from 'expo-router'
import { PlaceholderScreen } from '../../../features/placeholder/PlaceholderScreen'
import { useShell } from '../../../features/shell/ShellData'
import { t, type MessageKey } from '../../../messages'
import { moreFor, moreRouteKeys } from '../../../nav'

// A screen under More. One this role has no item for is access denied, never a blank; one nobody has is a 404.
export default function MoreItemScreen() {
  const { item } = useLocalSearchParams<{ item: string }>()
  const { seat } = useShell()
  const known = (moreRouteKeys as readonly string[]).includes(item)
  const allowed = moreFor(seat).some((group) => group.items.some((entry) => entry.kind === 'route' && entry.key === item))
  const title = known ? t(`more.${item}` as MessageKey) : t('states.notFound.label')
  return <PlaceholderScreen title={title} {...(allowed ? {} : { state: known ? ('denied' as const) : ('notFound' as const) })} />
}
