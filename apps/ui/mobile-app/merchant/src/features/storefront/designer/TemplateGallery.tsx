import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import type { DesignOverview } from '../../../api/studio'
import { chooseTemplate, scratchTemplate, type StorefrontTemplate } from '../../../api/storefrontSettings'
import { isApiError, type ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SheetFrame } from '../../shell/BottomSheet'

type Props = {
  client: ApiClient
  templates: readonly StorefrontTemplate[]
  status: DesignOverview['status']
  /** Null on the first visit, when there is nothing to go back to. */
  onBack: (() => void) | null
  onChosen: (template: StorefrontTemplate, keptWords: boolean) => Promise<void>
}

const refusals = ['BRAND_NOT_READY', 'INVALID_TEMPLATE', 'IN_PROGRESS', 'STUDIO_QUEUED', 'STUDIO_UNAVAILABLE', 'CHANGE_REFUSED', 'NOT_CONNECTED', 'READ_ONLY', 'SUPPORT_READ_ONLY', 'FORBIDDEN'] as const

const refusalText = (error: unknown): string => {
  if (!isApiError(error)) return t('storefront.gallery.refused.other')
  const code = refusals.find((candidate) => candidate === error.code)
  return code ? t(`storefront.gallery.refused.${code}`, { place: typeof error.details['place'] === 'number' ? error.details['place'] : 1 }) : t('storefront.gallery.refused.other')
}

const nameOf = (template: StorefrontTemplate): string => (template.key === scratchTemplate ? t('storefront.gallery.scratch') : template.name)

// The template gallery (PortalStorefront › gallery): the six looks and "Start from scratch", each a tile with its name (the API offers no picture, FIRST-RELEASE (store) §14).
// A site that exists asks whether to keep the merchant's words; the first pick has none to keep. The live site doesn't change until Publish.
export function TemplateGallery({ client, templates, status, onBack, onChosen }: Props) {
  const { colors, radii } = useTheme()
  const hasSite = status !== 'not_started' && status !== 'create_failed' && status !== 'creating'
  const [asking, setAsking] = useState<StorefrontTemplate | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(status === 'create_failed' ? t('storefront.gallery.failed') : null)

  const choose = async (template: StorefrontTemplate, keepWords: boolean) => {
    setAsking(null)
    setBusy(template.key)
    setProblem(null)
    try {
      await chooseTemplate(client, template.key, keepWords)
      await onChosen(template, keepWords)
    } catch (error) {
      setProblem(refusalText(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={styles.page}>
      {onBack ? (
        <Pressable accessibilityRole="link" onPress={onBack} style={styles.back}>
          <Text style={[styles.backText, { color: colors.link }]}>{t('storefront.gallery.back')}</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {hasSite ? t('storefront.gallery.change') : t('storefront.gallery.first')}
      </Text>
      <Text style={[styles.lede, { color: colors.textStrong }]}>{t('storefront.gallery.lede')}</Text>
      {problem ? <Notice kind="error" text={problem} /> : null}
      {templates.length === 0 ? <Notice text={`${t('storefront.gallery.emptyTitle')}. ${t('storefront.gallery.emptyBody')}`} /> : null}
      {templates.map((template) => (
        <View key={template.key} style={[styles.card, { backgroundColor: colors.surface, borderColor: template.current ? colors.focus : colors.border, borderRadius: radii.card }]}>
          <View style={[styles.tile, { backgroundColor: colors.neutralSurface, borderRadius: radii.button }]}>
            <Text style={[styles.tileName, { color: colors.heading }]}>{nameOf(template)}</Text>
          </View>
          <Text style={[styles.tag, { color: colors.muted }]}>{template.tag}</Text>
          <Text style={[styles.description, { color: colors.textStrong }]}>{template.description}</Text>
          {template.current ? <Text style={[styles.current, { color: colors.success }]}>{t('storefront.gallery.current')}</Text> : null}
          {template.demoUrl?.startsWith('https://') ? <Button kind="secondary" label={t('storefront.gallery.demo')} onPress={() => void Linking.openURL(template.demoUrl ?? '')} /> : null}
          <Button label={busy === template.key ? t('storefront.gallery.choosing') : t('storefront.gallery.use')} busy={busy === template.key} disabled={busy !== null} saves onPress={() => (hasSite ? setAsking(template) : void choose(template, true))} />
        </View>
      ))}
      {asking ? (
        <SheetFrame onClose={() => setAsking(null)}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.heading }]}>
            {asking.key === scratchTemplate ? t('storefront.gallery.keepScratchTitle') : t('storefront.gallery.keepTitle', { name: nameOf(asking) })}
          </Text>
          <Text style={[styles.description, { color: colors.textStrong }]}>{t('storefront.gallery.keepBody')}</Text>
          <View style={styles.sheetButtons}>
            <Button label={t('storefront.gallery.keepWords')} saves onPress={() => void choose(asking, true)} />
            <Button kind="secondary" label={t('storefront.gallery.templateWords')} saves onPress={() => void choose(asking, false)} />
            <Button kind="secondary" label={t('storefront.gallery.cancel')} onPress={() => setAsking(null)} />
          </View>
        </SheetFrame>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32, gap: 16 },
  back: { minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  lede: { fontSize: 15, lineHeight: 22 },
  card: { borderWidth: 1.5, padding: 14, gap: 10 },
  tile: { height: 96, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 20, fontWeight: '800' },
  tag: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  description: { fontSize: 14, lineHeight: 21 },
  current: { fontSize: 13, fontWeight: '700' },
  sheetTitle: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  sheetButtons: { gap: 8, paddingTop: 4 },
})
