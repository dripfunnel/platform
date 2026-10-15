import { StyleSheet, View } from 'react-native'
import type { ExportJob } from '../../api/exportJob'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'

type Props = { job: ExportJob; onShare: (job: ExportJob) => void }

// The export job's state in words (FIRST-RELEASE (store) §13): preparing, ready to share, expired, too large or failed.
export function ExportStatus({ job, onShare }: Props) {
  if (job.state === 'ready') {
    const text = job.truncated ? t('customers.export.truncated', { count: job.entries ?? 0 }) : tCount('customers.export.ready', job.entries ?? 0)
    return (
      <View style={styles.box}>
        <Notice kind="success" text={text} />
        <Button kind="secondary" label={t('customers.export.share')} onPress={() => onShare(job)} />
      </View>
    )
  }
  if (job.state === 'preparing') return <Notice text={t('customers.export.preparing')} />
  return <Notice kind="error" text={job.state === 'tooLarge' ? t('customers.export.tooLarge') : job.state === 'expired' ? t('customers.export.expired') : t('customers.export.failed')} />
}

const styles = StyleSheet.create({
  box: { gap: 8 },
})
