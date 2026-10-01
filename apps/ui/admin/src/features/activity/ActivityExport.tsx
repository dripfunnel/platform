import type { ActivityExport as ExportJob, ActivityPage } from '../../api/activity'
import { exportCap } from '../../api/activity'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import './activityLog.css'

const words = messages.activity.export

export interface ActivityExportProps {
  permission: ActivityPage['export']
  job: ExportJob | null
  onExport: () => void
}

const JobStatus = ({ job }: { job: ExportJob }) => {
  switch (job.state) {
    case 'preparing':
      return <>{words.preparing}</>
    case 'ready':
      return (
        <>
          {fill(plural(words.ready, job.entries ?? 0), { count: formatCount(job.entries ?? 0) })}{' '}
          {job.url && (
            <a href={job.url} download={fill(words.file, { date: new Date().toISOString().slice(0, 10) })} className="df-row-link">
              {words.download}
            </a>
          )}{' '}
          {job.expiresAt && fill(words.expires, { time: formatTime(job.expiresAt) })}
        </>
      )
    case 'expired':
      return <>{words.expired}</>
    case 'tooLarge':
      return <>{fill(words.tooLarge, { cap: formatCount(exportCap) })}</>
    case 'failed':
      return <>{words.failed}</>
  }
}

// Super admin and Engineer on call only; everyone else sees it disabled with the reason (decided on #44).
export const ActivityExport = ({ permission, job, onExport }: ActivityExportProps) => (
  <div className="df-activity-export">
    <ActionControl label={words.button} refusal={permission.allowed ? null : words.refusal} disabled={job?.state === 'preparing'} onRun={onExport} />
    <p className="df-muted">{words.recorded}</p>
    <p className="df-activity-export-status" role="status">
      {job && <JobStatus job={job} />}
    </p>
  </div>
)
