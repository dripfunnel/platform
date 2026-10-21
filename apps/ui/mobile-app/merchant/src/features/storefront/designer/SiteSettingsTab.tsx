import { View, StyleSheet } from 'react-native'
import { loadBrand, loadSeo, loadShareImages } from '../../../api/storefrontSettings'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { useLoad } from '../../common/useLoad'
import { Skeleton } from '../../states/StateView'
import { BrandCard } from './BrandCard'
import { SeoCard } from './SeoCard'

type Props = { client: ApiClient; canEdit: boolean }

// Site settings: Brand and Search and sharing. Domains, AI and build minutes and Version history are on the web portal (decided on #513).
export function SiteSettingsTab({ client, canEdit }: Props) {
  const loaded = useLoad(async () => {
    const [brand, seo, shareImages] = await Promise.all([loadBrand(client), loadSeo(client), loadShareImages(client).catch(() => [])])
    return { brand, seo, shareImages }
  }, [client])

  if (loaded.state.status === 'loading') return <Skeleton />
  if (loaded.state.status === 'error') {
    return (
      <View style={styles.page}>
        <Notice kind="error" text={errorMessage(loaded.state.error)} />
        <Button kind="secondary" label={t('storefront.content.error.retry')} onPress={loaded.reload} />
      </View>
    )
  }
  const { brand, seo, shareImages } = loaded.state.data
  return (
    <View style={styles.page}>
      {brand ? <BrandCard client={client} brand={brand} canEdit={canEdit} /> : null}
      <SeoCard client={client} seo={seo} shareImages={shareImages} canEdit={canEdit} />
    </View>
  )
}

const styles = StyleSheet.create({ page: { gap: 20 } })
