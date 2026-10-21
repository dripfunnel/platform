import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import type { StorefrontAccess } from '../access'
import { DiscardSheet } from '../StorefrontSheets'
import { siteOf } from '../siteView'
import type { ApiClient } from '../../../graphql'
import type { DesignerData } from './loadDesigner'

type Props = { client: ApiClient; access: StorefrontAccess; data: DesignerData; refresh: () => Promise<void>; onChangeTemplate: () => void; onOpenStudio: () => void }

// The Overview (PortalStorefront › Design): what is live, Change template, Open or Continue in studio, and the unpublished-changes notice with Discard. The live site refuses every frame
// (storefront ARCHITECTURE §3.5), so it is opened in the browser, not shown here.
export function DesignTab({ client, access, data, refresh, onChangeTemplate, onOpenStudio }: Props) {
  const { colors, radii } = useTheme()
  const { overview, host, templates } = data
  const [discarding, setDiscarding] = useState(false)
  const site = siteOf(overview.status)
  const draft = overview.draft !== null
  const template = overview.template
  const templateName = template === null ? t('storefront.overview.custom') : (templates.find((candidate) => candidate.key === template)?.name ?? template)

  if (site === 'creating') {
    return (
      <View style={styles.page}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
          {t('storefront.overview.creatingTitle')}
        </Text>
        <Notice text={t('storefront.overview.creatingBody')} />
      </View>
    )
  }

  const liveLine = overview.live ? t('storefront.overview.liveLine', { host: host ?? t('storefront.yourShop'), number: overview.live.number, template: templateName }) : t('storefront.overview.notLive')
  return (
    <View style={styles.page}>
      {access.viewOnly ? <Notice text={t('storefront.notice.manager')} /> : null}
      {access.readOnly ? <Notice text={t('storefront.readOnly')} /> : null}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        <Text style={[styles.live, { color: colors.heading }]}>{liveLine}</Text>
        {!overview.live ? <Text style={[styles.sub, { color: colors.muted }]}>{t('storefront.overview.notPublishedBody')}</Text> : null}
        {overview.live && host ? <Button kind="secondary" label={t('storefront.overview.viewLive')} onPress={() => void Linking.openURL(`https://${host}`)} /> : null}
        {access.canEdit ? <Button kind="secondary" label={t('storefront.overview.changeTemplate')} onPress={onChangeTemplate} /> : null}
        {access.canEdit ? <Button label={draft ? t('storefront.overview.continueStudio') : t('storefront.overview.openStudio')} onPress={onOpenStudio} /> : null}
      </View>
      {draft ? (
        <View style={[styles.card, { backgroundColor: colors.infoSurface, borderColor: colors.infoBorder, borderRadius: radii.card }]}>
          <Text style={[styles.live, { color: colors.info }]}>{t('storefront.overview.draftTitle')}</Text>
          <Text style={[styles.sub, { color: colors.info }]}>{t('storefront.overview.draftBody')}</Text>
          {access.canEdit ? <Button kind="secondary" label={t('storefront.overview.discard')} saves onPress={() => setDiscarding(true)} /> : null}
        </View>
      ) : null}
      {discarding ? <DiscardSheet client={client} onClose={() => setDiscarding(false)} onDone={refresh} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  heading: { fontSize: 20, fontWeight: '800' },
  card: { borderWidth: 1, padding: 14, gap: 12 },
  live: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  sub: { fontSize: 14, lineHeight: 21 },
})
