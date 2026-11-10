import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { copyProductQuestions, searchProductsWithQuestions, type CopiedQuestions } from '../../../api/products'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { Button } from '../../common/Button'
import { TextField } from '../../common/TextField'
import { SheetFrame } from '../../shell/BottomSheet'

type Found = { id: string; name: string; questionCount: number }
type Props = { client: ApiClient; productId: string; revision: number; hasQuestions: boolean; onCopied: (copied: CopiedQuestions) => void; onClose: () => void }

/** What a copy couldn't bring (U12), in words, or nothing. */
export const droppedWords = (copied: CopiedQuestions): string[] => [
  ...(copied.droppedAmounts > 0 ? [tCount('products.questions.copy.droppedAmounts', copied.droppedAmounts)] : []),
  ...(copied.droppedVersionLimits > 0 ? [tCount('products.questions.copy.droppedVersions', copied.droppedVersionLimits)] : []),
  ...(copied.droppedPhotos > 0 ? [tCount('products.questions.copy.droppedPhotos', copied.droppedPhotos)] : []),
]

// "Copy questions from another product" (CATALOG-DESIGN U12): the API's search of products with questions, then a confirmation that
// says it replaces this product's, at the revision the editor holds.
export function CopyQuestionsSheet({ client, productId, revision, hasQuestions, onCopied, onClose }: Props) {
  const { colors, radii } = useTheme()
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<Found[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setFailed(false)
    const timer = setTimeout(() => {
      searchProductsWithQuestions(client, search).then(
        (rows) => current && setFound(rows.filter((row) => row.id !== productId)),
        () => current && setFailed(true),
      )
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [client, search, productId])

  const copy = async () => {
    if (!picked) return
    setBusy(true)
    setProblem(null)
    try {
      onCopied(await copyProductQuestions(client, picked.id, productId, revision))
      onClose()
    } catch (error) {
      setProblem(errorMessage(error, 'products'))
      setBusy(false)
    }
  }

  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('products.questions.copy.title')}
      </Text>
      {picked ? (
        <>
          <Text style={[styles.body, { color: colors.textStrong }]}>
            {tCount(hasQuestions ? 'products.questions.copy.confirmReplace' : 'products.questions.copy.confirmNone', picked.questionCount, { name: picked.name })}
          </Text>
          {problem ? (
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
              {problem}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <Button saves busy={busy} label={t('products.questions.copy.confirm')} onPress={() => void copy()} />
            <Button kind="secondary" label={t('products.questions.copy.back')} onPress={() => setPicked(null)} />
          </View>
        </>
      ) : (
        <>
          <TextField label={t('products.questions.copy.search')} value={search} onChangeText={setSearch} autoCapitalize="none" />
          {failed ? (
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
              {t('products.questions.copy.failed')}
            </Text>
          ) : found === null ? (
            <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.muted }]}>
              {t('products.questions.copy.loading')}
            </Text>
          ) : found.length === 0 ? (
            <Text style={[styles.body, { color: colors.muted }]}>{t('products.questions.copy.none')}</Text>
          ) : (
            found.map((row) => {
              const count = tCount('products.questions.count', row.questionCount)
              return (
                <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.name}, ${count}`} onPress={() => setPicked(row)} style={[styles.row, { borderColor: colors.fieldBorder, borderRadius: radii.button }]}>
                  <Text style={[styles.name, { color: colors.text }]}>{row.name}</Text>
                  <Text style={[styles.count, { color: colors.muted }]}>{count}</Text>
                </Pressable>
              )
            })
          )}
          <Button kind="secondary" label={t('common.cancel')} onPress={onClose} />
        </>
      )}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 21 },
  buttons: { gap: 8, paddingTop: 4 },
  row: { borderWidth: 1, padding: 12, minHeight: 56, gap: 2, justifyContent: 'center' },
  name: { fontSize: 14, fontWeight: '700' },
  count: { fontSize: 13 },
})
