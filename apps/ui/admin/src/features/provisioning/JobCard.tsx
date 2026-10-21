import { StatusPill } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import type { JobAction, ProvisioningJob } from '../../api/provisioning'
import { fill, formatCount, formatTime, formatWait, messages } from '../../messages'
import { setupLook } from '../stores/storeLook'
import { JobActionButton } from './JobActionButton'
import './provisioning.css'

const words = messages.provisioning

const secondsSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))

// "Step 4 of 8", or "Step 3 of 3" for a store with its own frontend: the total is the job's own
// run, never a fixed number (decided on #43).
export const stepOf = (job: Pick<ProvisioningJob, 'steps' | 'step'>) =>
  fill(words.stepOf, { at: formatCount(job.steps.indexOf(job.step) + 1), total: formatCount(job.steps.length), step: words.steps[job.step] })

export interface JobCardProps {
  job: ProvisioningJob
  detailsOpen: boolean
  onToggleDetails: () => void
  onAction: (action: JobAction) => void
}

// The prototype's Provisioning card: the step reached, the error in plain words and the raw
// details behind a click. Every step is on the store's own tab, which the name opens (decided
// on #43).
export const JobCard = ({ job, detailsOpen, onToggleDetails, onAction }: JobCardProps) => {
  const titleId = useId()
  const detailsId = useId()
  return (
    <section className="df-job" aria-labelledby={titleId}>
      <div className="df-job-head">
        <div className="df-job-name">
          <Link id={titleId} to="/stores/$storeId" params={{ storeId: job.store.id }} search={{ tab: 'provisioning' }} className="df-row-title">
            {job.store.name}
          </Link>
          <span className="df-muted">
            <Link to="/partners/$partnerId" params={{ partnerId: job.partner.id }} className="df-row-link">
              {job.partner.name}
            </Link>{' '}
            · {job.store.code}
          </span>
        </div>
        <StatusPill {...setupLook[job.state]} label={words.states[job.state]} />
        <dl className="df-job-facts">
          <div>
            <dt>{words.stepReached}</dt>
            <dd>
              <strong>{stepOf(job)}</strong>
            </dd>
          </div>
          <div>
            <dt>{words.started}</dt>
            <dd>{fill(words.startedValue, { time: formatTime(job.startedAt), wait: formatWait(secondsSince(job.startedAt)) })}</dd>
          </div>
          <div>
            <dt>{words.attempts}</dt>
            <dd>{formatCount(job.attempts)}</dd>
          </div>
        </dl>
      </div>
      {job.error && <p className="df-job-error">{job.error}</p>}
      <div className="df-job-actions">
        {job.details && (
          <button type="button" className="df-button df-button--quiet" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={onToggleDetails}>
            {detailsOpen ? words.hideDetails : words.details}
          </button>
        )}
        <span className="df-job-spacer" />
        <JobActionButton actions={job.actions} action="retry" onRun={onAction} />
        <JobActionButton actions={job.actions} action="undo" onRun={onAction} />
      </div>
      {job.details && detailsOpen && (
        <code id={detailsId} className="df-job-details">
          {job.details}
        </code>
      )}
    </section>
  )
}
