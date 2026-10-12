import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'

export const AddressesPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.addresses.title')} lead={t('pages.addresses.lead')} />
    </Layout>
  )
}
