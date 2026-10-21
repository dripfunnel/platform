import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { failureWords } from '../siteView'
import type { Publishing } from '../usePublishRun'

type Props = {
  publishing: Publishing
  /** The number the publish would take, which a refusal names. */
  next: number
  /** The version a rolled-back publish put back. */
  backTo: number | null
  /** The change a refused publish blames, when it is in the conversation shown. */
  culprit: { id: string; text: string } | null
  onBefore: (messageId: string) => void
  onCheckAgain: () => void
}

// A publish's progress and its ends, in the studio's own words: the gate's steps, what failed with the live site unchanged, a rollback, or a publish that can't be read.
export function PublishNotice({ publishing, next, backTo, culprit, onBefore, onCheckAgain }: Props) {
  const { colors } = useTheme()
  if (publishing.phase === 'idle') return null
  if (publishing.phase === 'running') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.progress}>
        <ActivityIndicator color={colors.brand} />
        <Text style={[styles.step, { color: colors.textStrong }]}>{t(`storefront.publish.steps.${publishing.step}`)}</Text>
      </View>
    )
  }
  if (publishing.phase === 'rolledBack') return <Notice kind="error" text={backTo === null ? t('storefront.publish.rolledBackNoVersion') : t('storefront.publish.rolledBack', { number: backTo })} />
  if (publishing.phase === 'lost') {
    return (
      <View style={styles.group}>
        <Notice kind="error" text={t('storefront.studio.publish.lost')} />
        <Button kind="secondary" label={t('storefront.publish.checkAgain')} onPress={onCheckAgain} />
      </View>
    )
  }
  const lines = [`${t('storefront.publish.refusedTitle', { number: next })}.`, failureWords(publishing.run), culprit ? t('storefront.studio.publish.culprit', { text: culprit.text }) : null, t('storefront.publish.unchanged')]
  return (
    <View style={styles.group}>
      <Notice kind="error" text={lines.filter((line) => line !== null).join(' ')} />
      {culprit ? <Button kind="secondary" label={t('storefront.studio.publish.before')} saves onPress={() => onBefore(culprit.id)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  step: { fontSize: 14, fontWeight: '600' },
})
