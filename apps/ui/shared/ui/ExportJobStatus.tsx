import type { ExportJob } from '../graphql/exportJob'

export interface ExportJobWords {
  preparing: string
  // The count of entries the export holds, worded by the app (its plural rules).
  ready: (count: number) => string
  download: string
  // The file the browser saves, named by the app for today's date.
  file: (date: string) => string
  expires: (time: string) => string
  expired: string
  tooLarge: string
  failed: string
}

// One export job's state in the app's words: the line under an Export button (admin #44, platform #134).
export const ExportJobStatus = ({ job, words }: { job: ExportJob; words: ExportJobWords }) => {
  switch (job.state) {
    case 'preparing':
      return <>{words.preparing}</>
    case 'ready':
      return (
        <>
          {words.ready(job.entries ?? 0)}{' '}
          {job.url && (
            <a href={job.url} download={words.file(new Date().toISOString().slice(0, 10))} className="df-row-link">
              {words.download}
            </a>
          )}{' '}
          {job.expiresAt && words.expires(job.expiresAt)}
        </>
      )
    case 'expired':
      return <>{words.expired}</>
    case 'tooLarge':
      return <>{words.tooLarge}</>
    case 'failed':
      return <>{words.failed}</>
  }
}
