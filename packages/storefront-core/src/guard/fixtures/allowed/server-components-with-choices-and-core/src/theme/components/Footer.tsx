import { ConsentSettingsButton, PoweredBy, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Note } from './Note'

const columns = { left: 'start', right: 'end' } as const

export const Footer = () => {
  const { t, store, poweredBy } = useStorefront()
  const languages = Object.entries(columns).map(([side]) => side)
  return (
    <footer data-columns={languages.length}>
      <Note tone="cool" heading={t('common.footer.note')}>
        <p>{store.name}</p>
        <p>{t('common.nav.label', { count: store.currencies.length })}</p>
      </Note>
      <ConsentSettingsButton t={t} />
      <PoweredBy brand={poweredBy} t={t} />
      <time dateTime={store.timeZone}>{store.timeZone}</time>
    </footer>
  )
}
