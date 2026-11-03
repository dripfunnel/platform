import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'

export const VerifyPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.verify.title')} lead={t('pages.verify.lead')} />
    </Layout>
  )
}
