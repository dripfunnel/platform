import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { scratchTemplate } from '../../../api/storefrontSettings'
import { t } from '../../../messages'
import { sessionClient } from '../../../session'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Notice } from '../../common/Notice'
import { useLoad } from '../../common/useLoad'
import { loadStateOf } from '../../orders/loadState'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { ShellScreen } from '../../states/ShellScreen'
import { Skeleton } from '../../states/StateView'
import { ContentTab } from '../content/ContentTab'
import { siteOf } from '../siteView'
import { BrandStep } from './BrandStep'
import { DesignerTabs, type DesignerTab } from './DesignerTabs'
import { DesignTab } from './DesignTab'
import { loadDesigner } from './loadDesigner'
import { SiteSettingsTab } from './SiteSettingsTab'
import { TemplateGallery } from './TemplateGallery'

/** While the site is made the Design tab reads its status this often (the web portal's own number). */
const creatingPollMs = 5000

// The full designer (More › Storefront › Open here anyway; PortalStorefront at phone width): "Your brand" first for the Owner, the template gallery until a template is picked,
// then Design, Journal and Site settings, with the studio on its own screen. A Manager sees every part and changes none (FIRST-RELEASE (store) §14).
export function DesignerScreen() {
  const client = sessionClient()
  const router = useRouter()
  const feedback = useFeedback()
  const { colors } = useTheme()
  const { state, online } = useShell()
  const readOnly = state?.readOnly === true
  const loaded = useLoad(() => loadDesigner(client, readOnly), [client, readOnly])
  const { set } = loaded
  const [tab, setTab] = useState<DesignerTab>('design')
  const [gallery, setGallery] = useState(false)
  const label = t('more.storefront')

  // A change that fails to read again leaves what is shown as it was.
  const refresh = useCallback(async () => {
    try {
      set(await loadDesigner(client, readOnly))
    } catch {
      return
    }
  }, [client, readOnly, set])

  const creating = loaded.state.status === 'ready' && loaded.state.data.data !== null && siteOf(loaded.state.data.data.overview.status) === 'creating'
  useEffect(() => {
    if (!creating) return
    const timer = setInterval(() => void refresh(), creatingPollMs)
    return () => clearInterval(timer)
  }, [creating, refresh])

  if (loaded.state.status === 'error') {
    return (
      <ShellScreen label={label} state={loadStateOf(loaded.state.error, online)} onRetry={loaded.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (loaded.state.status === 'loading') {
    return (
      <ShellScreen label={label}>
        <Skeleton />
      </ShellScreen>
    )
  }
  const { access, data } = loaded.state.data
  if (data === null) {
    return (
      <ShellScreen label={label} state="denied">
        {null}
      </ShellScreen>
    )
  }
  const site = siteOf(data.overview.status)

  // "Your brand" replaces the whole page for the Owner until the shop name and logo are saved, and never shows to a reader.
  if (access.canEdit && data.brand?.brandReady !== true) {
    return (
      <ShellScreen label={label}>
        <BrandStep client={client} brand={data.brand} seo={data.seo} onSaved={refresh} />
      </ShellScreen>
    )
  }
  if (access.canEdit && (site === 'none' || gallery)) {
    return (
      <ShellScreen label={label}>
        <TemplateGallery
          client={client}
          templates={data.templates}
          status={data.overview.status}
          onBack={site === 'none' ? null : () => setGallery(false)}
          onChosen={async (template) => {
            setGallery(false)
            setTab('design')
            await refresh()
            feedback.toast({ message: template.key === scratchTemplate ? t('storefront.gallery.scratchStarted') : t('storefront.gallery.switched', { name: template.name }) })
          }}
        />
      </ShellScreen>
    )
  }
  return (
    <ShellScreen label={label}>
      <View style={styles.page}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('storefront.title')}
        </Text>
      </View>
      <DesignerTabs value={tab} onChange={setTab} />
      <View style={styles.body}>
        {site === 'none' ? <Notice text={t('storefront.design.noStorefront')} /> : null}
        {site !== 'none' && tab === 'design' ? <DesignTab client={client} access={access} data={data} refresh={refresh} onChangeTemplate={() => setGallery(true)} onOpenStudio={() => router.push('/more/storefront/studio' as never)} /> : null}
        {site !== 'none' && tab === 'journal' ? <ContentTab client={client} canEdit={access.canEdit} /> : null}
        {site !== 'none' && tab === 'settings' ? <SiteSettingsTab client={client} canEdit={access.canEdit} /> : null}
      </View>
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 4 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  body: { padding: 16, paddingBottom: 32, gap: 16 },
})
