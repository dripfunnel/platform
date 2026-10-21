import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { saveBrand, type StorefrontBrand } from '../../../api/storefrontSettings'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { useFeedback } from '../../shell/Feedback'
import { BrandFields } from './BrandFields'
import { brandComplete, brandFormOf, brandInputOf, brandProblemOf, isBrandDirty, type BrandForm, type FormProblem } from './brandDraft'

type Props = { client: ApiClient; brand: StorefrontBrand; canEdit: boolean }

// Site settings › Brand: the brand step's fields (its home page words are Search and sharing's). Your live site shows a change after the next publish.
export function BrandCard({ client, brand, canEdit }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [saved, setSaved] = useState(() => brandFormOf(brand))
  const [form, setForm] = useState<BrandForm>(saved)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<FormProblem | null>(null)
  const dirty = isBrandDirty(form, saved)

  const save = async () => {
    if (!brandComplete(form)) return setProblem({ field: 'shopName', text: t('storefront.brand.needed') })
    setBusy(true)
    setProblem(null)
    try {
      const next = brandFormOf(await saveBrand(client, brandInputOf(form)))
      setSaved(next)
      setForm(next)
      feedback.toast({ message: t('storefront.brand.card.saved') })
    } catch (error) {
      setProblem(brandProblemOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('storefront.brand.card.title')}
      </Text>
      <Text style={[styles.lede, { color: colors.textStrong }]}>{t('storefront.brand.card.lede')}</Text>
      {problem && problem.field === null ? <Notice kind="error" text={problem.text} /> : null}
      <BrandFields form={form} onChange={(patch) => setForm((now) => ({ ...now, ...patch }))} editable={canEdit} problem={problem} />
      {canEdit && dirty ? (
        <View style={styles.buttons}>
          <Button label={t('storefront.brand.card.save')} busy={busy} saves onPress={() => void save()} />
          <Button kind="secondary" label={t('storefront.brand.card.cancel')} disabled={busy} onPress={() => setForm(saved)} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  title: { fontSize: 20, fontWeight: '800' },
  lede: { fontSize: 14, lineHeight: 21 },
  buttons: { gap: 8 },
})
