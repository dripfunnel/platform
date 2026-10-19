import { useRouter } from 'expo-router'
import { loadHome, loadLocaleFacts } from '../../api/home'
import { loadAccess } from '../../api/products'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { useReloadOnFocus } from '../collections/useReloadOnFocus'
import { useLoad } from '../common/useLoad'
import { loadStateOf } from '../orders/loadState'
import { orderHref } from '../orders/routes'
import { canAddProduct } from '../products/access'
import { newProductHref } from '../products/routes'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { ActiveHome } from './ActiveHome'
import { isActiveStore } from './homeView'
import { NewStoreHome } from './NewStoreHome'
import { ordersHref } from './routes'

// What Home reads: what the seat holds, the API's `home`, and for a new store's Owner the facts of the checklist's first line, which only
// cost a read when that line is drawn and which a failure leaves out.
const loadPage = async (client: ApiClient) => {
  const [access, home] = await Promise.all([loadAccess(client), loadHome(client)])
  const facts = home !== null && !isActiveStore(home) && access.permissions.includes('settings') ? await loadLocaleFacts(client).catch(() => null) : null
  return { access, home, facts }
}

// The Home tab (DESIGN.md §3): `homeApp` for a store with activity, `PortalHome` for a new one, as the API's `home` answers. What a seat may
// not see is null there, and the screen leaves it out.
export function HomeScreen() {
  const router = useRouter()
  const client = sessionClient()
  const { seat, state, online, person, acting } = useShell()
  const page = useLoad(() => loadPage(client), [client])
  useReloadOnFocus(page.reload)

  if (page.state.status === 'error') {
    return (
      <ShellScreen label={t('tabs.home')} state={loadStateOf(page.state.error, online)} onRetry={page.reload}>
        {null}
      </ShellScreen>
    )
  }
  const data = page.state.status === 'ready' ? page.state.data : null
  if (data !== null && data.home === null) {
    return (
      <ShellScreen label={t('tabs.home')} state="notFound">
        {null}
      </ShellScreen>
    )
  }
  if (data === null || data.home === null) {
    return (
      <ShellScreen label={t('tabs.home')}>
        <Skeleton />
      </ShellScreen>
    )
  }

  const { access, facts } = data
  const home = data.home
  const open = (href: string) => router.push(href as never)
  return (
    <ShellScreen label={t('tabs.home')}>
      {isActiveStore(home) ? (
        <ActiveHome
          home={home}
          canAdd={canAddProduct(access, state?.readOnly === true)}
          onOpen={open}
          onAddProduct={() => open(newProductHref(seat))}
          onOpenOrder={(id) => open(orderHref(id))}
          onSeeOrders={() => open(ordersHref)}
        />
      ) : (
        <NewStoreHome home={home} name={person?.name ?? null} storeName={acting.storeName} seat={seat} canSettings={access.permissions.includes('settings')} facts={facts} onOpen={open} />
      )}
    </ShellScreen>
  )
}
