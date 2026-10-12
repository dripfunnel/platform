import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'

export const OrderPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.order.title')} lead={t('pages.order.lead')} />
    </Layout>
  )
}
