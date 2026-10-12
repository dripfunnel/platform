import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'

export const OrderConfirmationPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.confirmation.title')} lead={t('pages.confirmation.lead')} />
    </Layout>
  )
}
