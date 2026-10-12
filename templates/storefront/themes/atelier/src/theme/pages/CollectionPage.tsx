import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'

export const CollectionPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.collection.title')} lead={t('pages.collection.lead')} />
    </Layout>
  )
}
