import { loadLocale, loadStoreInfo } from '../../../api/settingsStore'
import { t } from '../../../messages'
import { TabFrame } from '../TabFrame'
import { CurrenciesCard } from './CurrenciesCard'
import { DetailsCard } from './DetailsCard'
import { LanguagesCard } from './LanguagesCard'

// Settings › Store info (SetStore; FIRST-RELEASE (store) §15): three cards, each saving on its own, so what is typed in one survives a save in
// another. Close my store (MA 18, #511) goes after the last card.
export function StoreInfoTab() {
  return (
    <TabFrame
      label={t('settings.tabs.store')}
      load={async (client) => {
        const [info, locale] = await Promise.all([loadStoreInfo(client), loadLocale(client)])
        if (!info || !locale) throw new Error('store info missing')
        return { info, locale }
      }}
    >
      {({ data, client, canEdit }) => (
        <>
          <DetailsCard info={data.info} client={client} canEdit={canEdit} />
          <CurrenciesCard loc={data.locale} client={client} canEdit={canEdit} />
          <LanguagesCard loc={data.locale} client={client} canEdit={canEdit} />
        </>
      )}
    </TabFrame>
  )
}
