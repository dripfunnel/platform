import { Image } from 'expo-image'
import * as Linking from 'expo-linking'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { LineAnswer } from '../../api/order'
import { locale, t } from '../../messages'
import { moneyText } from './orderView'

// JPEG, PNG and WebP preview; HEIC and PDF open as downloads (CATALOG-DESIGN §3 fact 56; #1374).
const previews = new Set(['image/jpeg', 'image/png', 'image/webp'])

const choiceText = (c: LineAnswer['choices'][number]) =>
  (c.quantity > 1 ? t('orders.detail.answers.choice', { label: c.label, count: formatNumber(c.quantity, locale) }) : c.label) + (c.free > 0 ? ` (${t('orders.detail.answers.free')})` : '')

function AnswerFile({ file, n, onFail }: { file: LineAnswer['files'][number]; n: number; onFail: () => void }) {
  const { colors } = useTheme()
  const name = t(file.mime === 'application/pdf' ? 'orders.detail.answers.pdf' : 'orders.detail.answers.photo', { n: formatNumber(n, locale) })
  const url = file.url
  if (!url) return <Text style={[styles.value, { color: colors.muted }]}>{t('orders.detail.answers.noLink', { name })}</Text>
  const open = () => void Linking.openURL(url).catch(onFail)
  if (previews.has(file.mime)) {
    return (
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('orders.detail.answers.open', { name })} onPress={open} style={styles.thumbTarget}>
        <Image source={{ uri: url }} accessibilityIgnoresInvertColors style={[styles.thumb, { borderColor: colors.border }]} contentFit="cover" />
      </Pressable>
    )
  }
  return (
    <Pressable accessibilityRole="link" onPress={open} style={styles.link}>
      <Text style={[styles.value, { color: colors.link }]}>{t('orders.detail.answers.download', { name })}</Text>
    </Pressable>
  )
}

/** A customised line's answers as placed (#1374): each question and its answer, and its extra when the caller reads money. */
export function LineAnswers({ answers }: { answers: readonly LineAnswer[] }) {
  const { colors } = useTheme()
  const [failed, setFailed] = useState(false)
  if (answers.length === 0) return null
  return (
    <View accessibilityLabel={t('orders.detail.answers.label')} style={styles.list}>
      {answers.map((a, i) => (
        <View key={`${a.question}-${i}`} style={styles.answer}>
          <Text style={[styles.question, { color: colors.muted }]}>{a.question}</Text>
          {a.kind === 'CHOICE' ? <Text style={[styles.value, { color: colors.text }]}>{a.choices.map(choiceText).join(', ')}</Text> : null}
          {a.kind === 'TEXT' ? <Text style={[styles.value, { color: colors.text }]}>{a.text ?? ''}</Text> : null}
          {a.kind === 'UPLOAD' ? (
            <View style={styles.files}>
              {a.files.map((f, j) => (
                <AnswerFile key={f.id} file={f} n={j + 1} onFail={() => setFailed(true)} />
              ))}
            </View>
          ) : null}
          {a.amount && BigInt(a.amount.amount) > 0n ? (
            <Text style={[styles.extra, { color: colors.muted }]}>
              {a.per === 'LINE' ? t('orders.detail.answers.extraOnce', { amount: moneyText(a.amount) }) : t('orders.detail.answers.extra', { amount: moneyText(a.amount) })}
            </Text>
          ) : null}
        </View>
      ))}
      {failed ? (
        <Text accessibilityRole="alert" style={[styles.extra, { color: colors.danger }]}>
          {t('orders.detail.answers.openFailed')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 6, paddingLeft: 12, paddingBottom: 6 },
  answer: { gap: 2 },
  question: { fontSize: 12 },
  value: { fontSize: 13, lineHeight: 18 },
  extra: { fontSize: 12 },
  files: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  thumbTarget: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  thumb: { width: 56, height: 56, borderRadius: 8, borderWidth: 1 },
  link: { minHeight: 44, justifyContent: 'center' },
})
