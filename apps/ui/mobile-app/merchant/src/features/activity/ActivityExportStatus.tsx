import { StyleSheet, Text, View } from 'react-native'
import type { ExportJob } from '../../api/exportJob'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'

type Props = { job: ExportJob; onShare: () => void }

// The export's state in words; a ready one can be shared again from here.
export function ActivityExportStatus({ job, onShare }: Props) {
  const { colors } = useTheme()
  const entries = job.entries ?? 0
  const words = {
    preparing: t('activity.export.preparing'),
    ready: job.truncated ? t('activity.export.truncated', { count: formatNumber(entries, locale) }) : tCount('activity.export.ready', entries, { total: formatNumber(entries, locale) }),
    expired: t('activity.export.expired'),
    tooLarge: t('activity.export.tooLarge'),
    failed: t('activity.export.failed'),
  }[job.state]
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <Text style={[styles.text, { color: job.state === 'failed' || job.state === 'tooLarge' ? colors.danger : colors.textStrong }]}>{words}</Text>
      {job.state === 'ready' && job.csv ? <Button kind="secondary" label={t('activity.export.share')} onPress={onShare} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  text: { fontSize: 14, lineHeight: 20 },
})
