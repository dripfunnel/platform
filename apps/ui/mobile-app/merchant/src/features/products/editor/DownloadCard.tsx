import { Pressable, StyleSheet, Text, View } from 'react-native'
import { downloadDays, downloadLimits } from '../../../api/productKinds'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { withDetails, type Draft } from './draft'
import { fileMeta } from './fileMeta'
import type { KindProblem } from './kindDetails'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; disabled: boolean; problems: readonly KindProblem[]; onPick: () => void }

// A download (CatEditor "What the shopper gets"): a private file, and how often and how long its link works. A pool of licence
// keys the web portal made is left as it is, with a note.
export function DownloadCard({ draft, update, disabled, problems, onPick }: Props) {
  const { colors, radii } = useTheme()
  const { download } = draft.details
  const set = (change: Partial<typeof download>) => update((d) => withDetails(d, 'download', change))
  const busy = download.uploading
  const refusal = download.refusal ? errorMessage(new ApiError(download.refusal, 'The API refused the upload.'), 'productFile') : null

  return (
    <SectionCard title={t('products.kinds.download.title')}>
      {download.mode === 'keys' ? (
        <Notice text={t('products.kinds.download.keys')} />
      ) : (
        <View style={{ gap: 14 }}>
          {download.file ? (
            <View style={[styles.file, { borderColor: colors.border, borderRadius: radii.button }]}>
              <Text style={[styles.meta, { color: colors.text }]}>{fileMeta(download.file)}</Text>
              {!disabled ? <Button kind="secondary" label={busy ? t('products.kinds.download.uploading') : t('products.kinds.download.replace')} onPress={onPick} disabled={busy} /> : null}
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? t('products.kinds.download.uploading') : t('products.kinds.download.upload')}
              accessibilityState={{ disabled: disabled || busy, busy }}
              disabled={disabled || busy}
              onPress={onPick}
              style={[styles.drop, { borderColor: colors.fieldBorder, borderRadius: radii.button, backgroundColor: colors.neutralSurface, opacity: disabled ? 0.6 : 1 }]}
            >
              <Text style={[styles.dropTitle, { color: colors.text }]}>{busy ? t('products.kinds.download.uploading') : t('products.kinds.download.upload')}</Text>
              <Text style={[styles.hint, { color: colors.muted }]}>{t('products.kinds.download.uploadHint')}</Text>
            </Pressable>
          )}
          {refusal ? <Notice kind="error" text={refusal} /> : null}
          {problems.includes('file') && !refusal ? <Text style={{ color: colors.danger, fontSize: 13 }}>{t('products.kinds.download.missing')}</Text> : null}
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.text }]}>{t('products.kinds.download.limit')}</Text>
            <View style={styles.chips}>
              {downloadLimits.map((n) => (
                <Chip key={n} label={formatNumber(n, locale)} accessibilityLabel={`${t('products.kinds.download.limit')}: ${formatNumber(n, locale)}`} selected={download.limit === n} disabled={disabled} onPress={() => set({ limit: n })} />
              ))}
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: colors.text }]}>{t('products.kinds.download.days')}</Text>
            <View style={styles.chips}>
              {downloadDays.map((n) => (
                <Chip key={n} label={t(`products.kinds.download.dayOptions.d${n}`)} accessibilityLabel={`${t('products.kinds.download.days')}: ${t(`products.kinds.download.dayOptions.d${n}`)}`} selected={download.days === n} disabled={disabled} onPress={() => set({ days: n })} />
              ))}
            </View>
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>{t('products.kinds.download.rule')}</Text>
        </View>
      )}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  file: { borderWidth: 1, padding: 12, gap: 10 },
  meta: { fontSize: 14, fontWeight: '700' },
  drop: { borderWidth: 2, borderStyle: 'dashed', padding: 20, alignItems: 'center', gap: 4, minHeight: 88, justifyContent: 'center' },
  dropTitle: { fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 18 },
  label: { fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
