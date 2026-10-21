import { StatusPill } from '@dripfunnel/shared/ui'
import type { JobAction } from '../../api/provisioning'
import type { ProvisioningStep } from '../../api/provisioningSteps'
import type { Store } from '../../api/stores'
import { fill, formatCount, messages } from '../../messages'
import { JobActionButton } from '../provisioning/JobActionButton'
import { setupLook } from './storeLook'
import './stores.css'

const words = messages.store.provisioning
const steps = messages.provisioning.steps

type StepStatus = keyof typeof words.stepStatus

const statusOf = (step: ProvisioningStep, setup: Store['setup']): StepStatus => {
  if (setup.state === 'done' || setup.step === null) return 'done'
  const at = setup.steps.indexOf(setup.step)
  const index = setup.steps.indexOf(step)
  if (index < at) return 'done'
  return index === at ? setup.state : 'waiting'
}

// The total is this store's own run, never a fixed number (decided on #43).
const summary = ({ setup }: Store) => {
  if (setup.state === 'done' || setup.step === null) return words.summaryDone
  const values = {
    at: formatCount(setup.steps.indexOf(setup.step) + 1),
    total: formatCount(setup.steps.length),
    step: steps[setup.step],
    attempts: formatCount(setup.attempts),
  }
  return fill(setup.attempts === 1 ? words.summaryOne : words.summary, values)
}

const StepPill = ({ status }: { status: StepStatus }) =>
  status === 'waiting' ? (
    <StatusPill tone="neutral" icon="pen" label={words.stepStatus.waiting} />
  ) : (
    <StatusPill {...setupLook[status]} label={words.stepStatus[status]} />
  )

export interface ProvisioningTabProps {
  store: Store
  onJob: (action: JobAction) => void
}

// The store's signup steps, SAAS.md §5's eight or the three a store with its own frontend runs.
// Retry sits on the failed or stuck step, and Undo and clean up only for a failed signup
// (decided on #20); both are the signup job's, shared with the Provisioning list (#43).
export const ProvisioningTab = ({ store, onJob }: ProvisioningTabProps) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-labelledby="store-steps">
      <div className="df-panel-head">
        <h2 id="store-steps">{words.title}</h2>
        <span className="df-muted">{summary(store)}</span>
      </div>
      {store.setup.steps.length === 0 && <p className="df-muted">{words.noSteps}</p>}
      <ol className="df-steps">
        {store.setup.steps.map((step, index) => {
          const status = statusOf(step, store.setup)
          const blocked = status === 'failed' || status === 'stuck'
          return (
            <li key={step}>
              <span className="df-step-number">{formatCount(index + 1)}</span>
              <span>{steps[step]}</span>
              <span className="df-step-status">
                <StepPill status={status} />
                {blocked && store.job && <JobActionButton actions={store.job.actions} action="retry" label={words.retry} onRun={onJob} />}
              </span>
              {blocked && store.provisioning.error && <p className="df-step-detail df-step-error">{store.provisioning.error}</p>}
            </li>
          )
        })}
      </ol>
    </section>
    {store.setup.state === 'failed' && store.job?.actions.undo && (
      <section className="df-panel df-panel--wide" aria-labelledby="store-undo">
        <h2 id="store-undo">{words.undoTitle}</h2>
        <p className="df-muted">{words.undoSub}</p>
        <JobActionButton actions={store.job.actions} action="undo" onRun={onJob} />
      </section>
    )}
  </div>
)
