import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { assetPath } from '../../../api/products'
import { saveSeo, seoLimits, type StorefrontSeo } from '../../../api/storefrontSettings'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { TextArea } from '../../common/TextArea'
import { TextField } from '../../common/TextField'
import { ProductPhoto } from '../../products/ProductPhoto'
import { isSeoDirty, seoFormOf, seoProblemText, seoTooLong, type SeoForm } from './seoDraft'

type Props = { client: ApiClient; seo: StorefrontSeo; shareImages: readonly string[]; canEdit: boolean }

// Search and sharing (PortalStorefront › Site settings): how the home page reads in Google and when a link is shared. Saving renders the home page again at
// once and uses no allowance, so it needs no publish (FIRST-RELEASE (store) §14).
export function SeoCard({ client, seo, shareImages, canEdit }: Props) {
  const { colors } = useTheme()
  const [saved, setSaved] = useState(() => seoFormOf(seo))
  const [form, setForm] = useState<SeoForm>(saved)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const over = seoTooLong(form)
  const dirty = isSeoDirty(form, saved)
  const set = (change: Partial<SeoForm>) => {
    setForm((now) => ({ ...now, ...change }))
    setDone(false)
  }
  const count = (length: number, limit: number) => (length > limit ? t('storefront.seo.countOver', { count: length, limit }) : t('storefront.seo.count', { count: length, limit }))
  // A photo already chosen that is no longer among the newest still shows, so it can be left or cleared.
  const photos = form.shareImageAssetId !== null && !shareImages.includes(form.shareImageAssetId) ? [form.shareImageAssetId, ...shareImages] : shareImages

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const answer = await saveSeo(client, { title: form.title.trim(), description: form.description.trim(), shareImageAssetId: form.shareImageAssetId })
      const next = seoFormOf(answer)
      setSaved(next)
      setForm(next)
      setDone(true)
    } catch (error) {
      setProblem(seoProblemText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title={t('storefront.seo.title')} sub={t('storefront.seo.lede')}>
      {problem ? <Notice kind="error" text={problem} /> : null}
      {done ? <Notice kind="success" text={t('storefront.seo.saved')} /> : null}
      {over ? <Notice kind="error" text={t('storefront.seo.tooLong')} /> : null}
      <TextField label={t('storefront.seo.pageTitle')} value={form.title} onChangeText={(title) => set({ title })} editable={canEdit} autoCapitalize="sentences" invalid={form.title.length > seoLimits.title} help={count(form.title.length, seoLimits.title)} />
      <TextArea label={t('storefront.seo.description')} value={form.description} onChangeText={(description) => set({ description })} editable={canEdit} lines={3} />
      <Text style={[styles.count, { color: form.description.length > seoLimits.description ? colors.danger : colors.muted }]}>{count(form.description.length, seoLimits.description)}</Text>
      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('storefront.seo.shareImage')}</Text>
        <Text style={[styles.count, { color: colors.muted }]}>{photos.length === 0 ? t('storefront.seo.noPhotos') : t('storefront.seo.shareHelp')}</Text>
        <View style={styles.photos}>
          {photos.map((assetId, index) => {
            const chosen = form.shareImageAssetId === assetId
            return (
              <Pressable
                key={assetId}
                accessibilityRole="button"
                accessibilityLabel={t('storefront.seo.usePhoto', { number: index + 1 })}
                accessibilityState={{ selected: chosen, disabled: !canEdit }}
                disabled={!canEdit}
                onPress={() => set({ shareImageAssetId: chosen ? null : assetId })}
                style={[styles.photo, { borderColor: chosen ? colors.focus : 'transparent' }]}
              >
                <ProductPhoto path={assetPath(assetId)} size={64} label={t('storefront.seo.photoAlt', { number: index + 1 })} radius={8} showEmpty={false} />
              </Pressable>
            )
          })}
        </View>
      </View>
      {canEdit && dirty ? <Button label={t('storefront.seo.save')} busy={busy} disabled={over} saves onPress={() => void save()} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  count: { fontSize: 13, lineHeight: 18 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photo: { borderWidth: 2, borderRadius: 10, padding: 2 },
})
