import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Eyebrow } from '../common/Eyebrow'
import { Notice } from '../common/Notice'
import { failureWords, type LastPublish } from './siteView'
import type { Publishing } from './usePublishRun'

type Props = {
  request: string | null
  publishing: Publishing
  /** The number the publish would take, which a refusal names. */
  next: number
  /** The API's record of the last publish, shown while it left this draft behind. */
  lastPublish: LastPublish
  /** The version a rolled-back publish put back. */
  backTo: number | null
  onPreview: () => void
  onDiscard: () => void
  onPublish: () => void
  onCheckAgain: () => void
}

// A draft waiting: preview it in the browser, throw it away or publish it. While a publish runs the card says which step it is on and holds still.
export function DraftCard({ request, publishing, next, lastPublish, backTo, onPreview, onDiscard, onPublish, onCheckAgain }: Props) {
  const { colors, radii } = useTheme()
  const running = publishing.phase === 'running'
  const idle = publishing.phase === 'idle'
  return (
    <View style={styles.group}>
      <Eyebrow text={t('storefront.draft.eyebrow')} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        <Text style={[styles.quote, { color: colors.heading }]}>{request ? `“${request}”` : t('storefront.draft.fallback')}</Text>
        {publishing.phase === 'failed' ? <Notice kind="error" text={`${t('storefront.publish.refusedTitle', { number: next })}. ${failureWords(publishing.run)} ${t('storefront.publish.unchanged')}`} /> : null}
        {publishing.phase === 'rolledBack' ? <Notice kind="error" text={backTo === null ? t('storefront.publish.rolledBackNoVersion') : t('storefront.publish.rolledBack', { number: backTo })} /> : null}
        {idle && lastPublish === 'failed' ? <Notice kind="error" text={t('storefront.draft.lastFailed')} /> : null}
        {idle && lastPublish === 'rolled_back' ? <Notice kind="error" text={t('storefront.draft.lastRolledBack')} /> : null}
        {publishing.phase === 'lost' ? (
          <>
            <Notice kind="error" text={t('storefront.publish.lost')} />
            <Button kind="secondary" label={t('storefront.publish.checkAgain')} onPress={onCheckAgain} />
          </>
        ) : null}
        {publishing.phase === 'running' ? (
          <View accessibilityLiveRegion="polite" style={styles.progress}>
            <ActivityIndicator color={colors.brand} />
            <Text style={[styles.step, { color: colors.textStrong }]}>{t(`storefront.publish.steps.${publishing.step}`)}</Text>
          </View>
        ) : null}
        <Button kind="secondary" label={t('storefront.draft.preview')} disabled={running} onPress={onPreview} />
        <View style={styles.row}>
          <View style={styles.discard}>
            <Button kind="secondary" label={t('storefront.draft.discard')} disabled={running} saves onPress={onDiscard} />
          </View>
          <View style={styles.publish}>
            <Button label={t('storefront.draft.publish')} disabled={running} saves onPress={onPublish} />
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  card: { borderWidth: 1, padding: 14, gap: 12 },
  quote: { fontSize: 16, fontWeight: '700', lineHeight: 22 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  discard: { flex: 1 },
  publish: { flex: 2 },
})
