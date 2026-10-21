import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { SetupStepState, Store, StoreAction } from '../../../api/stores'
import { formatTime, messages } from '../../../messages'
import { StoreActionButton } from '../StoreActions'

const words = messages.store.setup

const stepLook: Record<SetupStepState, { tone: StatusTone; icon: StatusIconName }> = {
  done: { tone: 'success', icon: 'ok' },
  running: { tone: 'info', icon: 'clock' },
  slow: { tone: 'warning', icon: 'clock' },
  failed: { tone: 'danger', icon: 'cross' },
  waiting: { tone: 'neutral', icon: 'pause' },
}

// Setup (§6.3): the five signup steps and their results; Retry this step for Owners and Admins when one is stuck.
export const SetupTab = ({ store, onAction }: { store: Store; onAction: (action: StoreAction) => void }) => (
  <div className="df-panels">
    <section className="df-panel df-panel--wide" aria-labelledby="store-setup">
      <div className="df-panel-head">
        <h2 id="store-setup">{words.title}</h2>
        <StoreActionButton store={store} action="retryStep" onAction={onAction} primary />
      </div>
      <ol className="df-steps">
        {store.setup.steps.map((step) => (
          <li key={step.key}>
            <strong>{words.steps[step.key]}</strong>
            <span className="df-muted">{step.detail?.kind === 'at' ? formatTime(step.detail.at) : (step.detail?.text ?? '')}</span>
            <StatusPill {...stepLook[step.state]} label={words.states[step.state]} />
          </li>
        ))}
      </ol>
    </section>
  </div>
)
