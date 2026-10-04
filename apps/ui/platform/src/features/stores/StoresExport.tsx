import type { ExportJob } from '@dripfunnel/shared/graphql'
import { ActionControl, ExportJobStatus, type ExportJobWords } from '@dripfunnel/shared/ui'
import type { ActionPermission } from '../../api/stores'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'

const words = messages.stores.export

const jobWords: ExportJobWords = {
  preparing: words.preparing,
  ready: (count, truncated) => fill(plural(truncated ? words.truncated : words.ready, count), { count: formatCount(count) }),
  download: words.download,
  file: (date) => fill(words.file, { date }),
  expires: (time) => fill(words.expires, { time: formatTime(time) }),
  expired: words.expired,
  tooLarge: words.failed,
  failed: words.failed,
}

export interface StoresExportProps {
  permission: ActionPermission
  job: ExportJob | null
  onExport: () => void
}

// Export accounts (CSV) is a job (FIRST-RELEASE.md §6.1, §16): started here, followed by the shell's ExportWatcher.
export const StoresExport = ({ permission, job, onExport }: StoresExportProps) => (
  <div className="df-stores-export">
    <ActionControl label={words.button} refusal={permission.allowed ? null : fill(messages.store.refused[permission.reason], { verb: messages.store.verbs.export, name: '' })} disabled={job?.state === 'preparing'} onRun={onExport} />
    <p className="df-muted">{words.note}</p>
    <p className="df-stores-export-status" role="status">
      {job && <ExportJobStatus job={job} words={jobWords} />}
    </p>
  </div>
)
