import { provisioningSteps, type ProvisioningStep, type Store } from '../../api/stores'
import { fill, formatCount, messages } from '../../messages'
import { StatusPill } from '../common/StatusPill'
import { StoreActionButton, type StoreActionsProps } from './StoreActions'
import { setupLook } from './storeLook'
import './stores.css'

const words = messages.store.provisioning

type StepStatus = keyof typeof words.stepStatus

const statusOf = (step: ProvisioningStep, setup: Store['setup']): StepStatus => {
  if (setup.state === 'done') return 'done'
  const at = provisioningSteps.indexOf(setup.step)
  const index = provisioningSteps.indexOf(step)
  if (index < at) return 'done'
  return index === at ? setup.state : 'waiting'
}

const summary = ({ setup }: Store) => {
  if (setup.state === 'done') return words.summaryDone
  const values = { at: formatCount(provisioningSteps.indexOf(setup.step) + 1), step: words.steps[setup.step], attempts: formatCount(setup.attempts) }
  return fill(setup.attempts === 1 ? words.summaryOne : words.summary, values)
}

const StepPill = ({ status }: { status: StepStatus }) =>
  status === 'waiting' ? (
    <StatusPill tone="neutral" icon="pen" label={words.stepStatus.waiting} />
  ) : (
    <StatusPill {...setupLook[status]} label={words.stepStatus[status]} />
  )

// The prototype's signup steps. Retry sits on the failed or stuck step, and Undo and clean up
// only for a failed signup (decided on #20).
export const ProvisioningTab = ({ store, onAction }: StoreActionsProps & { store: Store }) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-labelledby="store-steps">
      <div className="df-panel-head">
        <h2 id="store-steps">{words.title}</h2>
        <span className="df-muted">{summary(store)}</span>
      </div>
      <ol className="df-steps">
        {provisioningSteps.map((step, index) => {
          const status = statusOf(step, store.setup)
          const blocked = status === 'failed' || status === 'stuck'
          return (
            <li key={step}>
              <span className="df-step-number">{formatCount(index + 1)}</span>
              <span>{words.steps[step]}</span>
              <span className="df-step-status">
                <StepPill status={status} />
                {blocked && <StoreActionButton store={store} action="retry" label={words.retry} primary onAction={onAction} />}
              </span>
              {blocked && store.provisioning.error && <p className="df-step-detail df-step-error">{store.provisioning.error}</p>}
            </li>
          )
        })}
      </ol>
    </section>
    {store.actions.undo && (
      <section className="df-panel df-panel--wide" aria-labelledby="store-undo">
        <h2 id="store-undo">{words.undoTitle}</h2>
        <p className="df-muted">{words.undoSub}</p>
        <StoreActionButton store={store} action="undo" onAction={onAction} />
      </section>
    )}
  </div>
)
