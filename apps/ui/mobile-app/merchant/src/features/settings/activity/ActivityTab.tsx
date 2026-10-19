import { loadAccess } from '../../../api/products'
import { loadStoreTimeZone } from '../../../api/storeInfo'
import { t } from '../../../messages'
import { activityAccessOf } from '../../activity/access'
import { ActivityView } from '../../activity/ActivityView'
import { TabFrame } from '../TabFrame'

// Settings › Activity log (StoreActivity; FIRST-RELEASE (store) §15): the Owner's view of the log. A store past due still reads, which TabFrame's "read-only" line does not say.
export function ActivityTab() {
  return (
    <TabFrame
      label={t('settings.tabs.activity')}
      load={async (client) => {
        const [acting, timeZone] = await Promise.all([loadAccess(client), loadStoreTimeZone(client).catch(() => null)])
        return { access: activityAccessOf(acting), timeZone: timeZone ?? 'UTC' }
      }}
    >
      {({ data, client }) => <ActivityView title={t('activity.title')} client={client} timeZone={data.timeZone} />}
    </TabFrame>
  )
}
