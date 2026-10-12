import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { PageIntro } from '../components/PageIntro'

export const PolicyPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.policy.title')} lead={t('pages.policy.lead')} />
    </Layout>
  )
}
