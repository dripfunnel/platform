import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'

export const ProductPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.product.title')} lead={t('pages.product.lead')} />
    </Layout>
  )
}
