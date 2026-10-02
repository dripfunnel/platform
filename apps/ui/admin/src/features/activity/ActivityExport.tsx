import type { ActivityExport as ExportJob, ActivityPage } from '../../api/activity'
import { exportCap } from '../../api/activity'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { ActionControl, ExportJobStatus, type ExportJobWords } from '@dripfunnel/shared/ui'
import './activityLog.css'

const words = messages.activity.export

export interface ActivityExportProps {
  permission: ActivityPage['export']
  job: ExportJob | null
  onExport: () => void
}

const jobWords: ExportJobWords = {
  preparing: words.preparing,
  ready: (count) => fill(plural(words.ready, count), { count: formatCount(count) }),
  download: words.download,
  file: (date) => fill(words.file, { date }),
  expires: (time) => fill(words.expires, { time: formatTime(time) }),
  expired: words.expired,
  tooLarge: fill(words.tooLarge, { cap: formatCount(exportCap) }),
  failed: words.failed,
}

// Super admin and Engineer on call only; everyone else sees it disabled with the reason (decided on #44).
export const ActivityExport = ({ permission, job, onExport }: ActivityExportProps) => (
  <div className="df-activity-export">
    <ActionControl label={words.button} refusal={permission.allowed ? null : words.refusal} disabled={job?.state === 'preparing'} onRun={onExport} />
    <p className="df-muted">{words.recorded}</p>
    <p className="df-activity-export-status" role="status">
      {job && <ExportJobStatus job={job} words={jobWords} />}
    </p>
  </div>
)
