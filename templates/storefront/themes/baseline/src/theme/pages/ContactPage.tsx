import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'

export const ContactPage = () => {
  const { store, t } = useStorefront()
  const place = [store.address?.street, store.address?.city, store.address?.region, store.address?.postal].filter(Boolean).join(', ')
  return (
    <Layout>
      <PageIntro title={t('pages.contact.title')} lead={t('pages.contact.lead')}>
        <dl className="mt-2 mr-0 mb-0 ml-0 grid gap-y-3.5 gap-x-3.5">
          {store.contactEmail ? (
            <div className="flex flex-col">
              <dt className="text-muted text-[12px] tracking-[0.08em] uppercase">{t('pages.contact.email')}</dt>
              <dd className="m-0 text-[16px] wrap-anywhere">{store.contactEmail}</dd>
            </div>
          ) : null}
          {store.contactPhone ? (
            <div className="flex flex-col">
              <dt className="text-muted text-[12px] tracking-[0.08em] uppercase">{t('pages.contact.phone')}</dt>
              <dd className="m-0 text-[16px] wrap-anywhere">{store.contactPhone}</dd>
            </div>
          ) : null}
          {place ? (
            <div className="flex flex-col">
              <dt className="text-muted text-[12px] tracking-[0.08em] uppercase">{t('pages.contact.visit')}</dt>
              <dd className="m-0 text-[16px] wrap-anywhere">{place}</dd>
            </div>
          ) : null}
        </dl>
      </PageIntro>
    </Layout>
  )
}
