import { loadStoreTimeZone } from '../../../api/storeInfo'
import { t } from '../../../messages'
import { ActivityView } from '../../activity/ActivityView'
import { TabFrame } from '../TabFrame'

// Settings › Activity log (StoreActivity; FIRST-RELEASE (store) §15): the Owner's view of the log, behind Settings' own Owner gate (the `activity.read` and `activity.export` checks are the Manager's screen's), so it exports.
// A store past due still reads and exports, which TabFrame's "read-only" line does not say.
export function ActivityTab() {
  return (
    <TabFrame
      label={t('settings.tabs.activity')}
      load={async (client) => {
        return { timeZone: (await loadStoreTimeZone(client).catch(() => null)) ?? 'UTC' }
      }}
    >
      {({ data, client }) => <ActivityView title={t('activity.title')} client={client} timeZone={data.timeZone} canExport />}
    </TabFrame>
  )
}
