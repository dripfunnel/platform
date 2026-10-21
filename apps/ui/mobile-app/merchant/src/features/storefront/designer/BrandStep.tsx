import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { saveBrand, saveSeo, seoLimits, type StorefrontBrand, type StorefrontSeo } from '../../../api/storefrontSettings'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { TextArea } from '../../common/TextArea'
import { TextField } from '../../common/TextField'
import { BrandFields } from './BrandFields'
import { brandComplete, brandFormOf, brandInputOf, brandProblemOf, type BrandForm, type FormProblem } from './brandDraft'
import { seoFormOf, seoProblemText, seoTooLong } from './seoDraft'

type Props = { client: ApiClient; brand: StorefrontBrand | null; seo: StorefrontSeo | null; onSaved: () => Promise<void> }

// "Your brand" (FIRST-RELEASE (store) §14): the Owner's first visit, before the gallery. Only the name and logo are needed; the home page's words are
// saved first, since they are Search and sharing's, then the brand.
export function BrandStep({ client, brand, seo, onSaved }: Props) {
  const { colors } = useTheme()
  const [form, setForm] = useState<BrandForm>(() => brandFormOf(brand))
  const [home, setHome] = useState(() => seoFormOf(seo))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<FormProblem | null>(null)
  const change = (patch: Partial<BrandForm>) => {
    setForm((now) => ({ ...now, ...patch }))
    setProblem(null)
  }
  const complete = brandComplete(form)

  const save = async () => {
    if (!brandComplete(form)) return
    setBusy(true)
    setProblem(null)
    try {
      if (home.title.trim() !== (seo?.title ?? '') || home.description.trim() !== (seo?.description ?? '')) {
        try {
          await saveSeo(client, { title: home.title.trim(), description: home.description.trim(), shareImageAssetId: home.shareImageAssetId })
        } catch (error) {
          return setProblem({ field: null, text: seoProblemText(error) })
        }
      }
      await saveBrand(client, brandInputOf(form))
      await onSaved()
    } catch (error) {
      setProblem(brandProblemOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('storefront.brand.title')}
      </Text>
      <Text style={[styles.lede, { color: colors.textStrong }]}>{t('storefront.brand.lede')}</Text>
      {problem && problem.field === null ? <Notice kind="error" text={problem.text} /> : null}
      <BrandFields form={form} onChange={change} editable problem={problem} />
      <SectionCard title={t('storefront.brand.sections.home')} sub={t('storefront.brand.sections.homeHelp')}>
        <TextField label={t('storefront.brand.homeTitle')} value={home.title} onChangeText={(title) => setHome((now) => ({ ...now, title }))} autoCapitalize="sentences" invalid={home.title.length > seoLimits.title} help={t('storefront.brand.count', { count: home.title.length, limit: seoLimits.title })} />
        <TextArea label={t('storefront.brand.homeDescription')} value={home.description} onChangeText={(description) => setHome((now) => ({ ...now, description }))} lines={3} />
        <Text style={[styles.hint, { color: seoTooLong(home) ? colors.danger : colors.muted }]}>{t('storefront.brand.count', { count: home.description.length, limit: seoLimits.description })}</Text>
      </SectionCard>
      {complete ? null : <Text style={[styles.hint, { color: colors.muted }]}>{t('storefront.brand.needed')}</Text>}
      <Button label={busy ? t('storefront.brand.saving') : t('storefront.brand.continue')} busy={busy} disabled={!complete || seoTooLong(home)} saves onPress={() => void save()} />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  lede: { fontSize: 15, lineHeight: 22 },
  hint: { fontSize: 13, lineHeight: 18 },
})
