import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { ProvisioningProgress } from '../../api/stores'
import { fill, formatWait, messages } from '../../messages'

const words = messages.stores.new.setup

const stepLook: Record<ProvisioningProgress['steps'][number]['state'], { tone: StatusTone; icon: StatusIconName }> = {
  done: { tone: 'success', icon: 'ok' },
  running: { tone: 'info', icon: 'clock' },
  waiting: { tone: 'neutral', icon: 'pause' },
  failed: { tone: 'danger', icon: 'alert' },
}

export interface ProvisioningPanelProps {
  storeId: string
  storeName: string
  ownerName: string
  progress: ProvisioningProgress | null
  onAgain: () => void
}

// "Setting up {store}" with the signup job's steps (SAAS.md §5), then the way into the store.
export const ProvisioningPanel = ({ storeId, storeName, ownerName, progress, onAgain }: ProvisioningPanelProps) => (
  <section className="df-setup" role="status" aria-live="polite">
    <h2>{fill(words.title, { store: storeName })}</h2>
    <p className="df-muted">{progress?.done ? fill(words.ready, { duration: formatWait(progress.elapsedSeconds), owner: ownerName }) : words.note}</p>
    <ol className="df-setup-steps">
      {(progress?.steps ?? []).map((step) => (
        <li key={step.key}>
          <strong>{words.steps[step.key]}</strong>
          <StatusPill {...stepLook[step.state]} label={words.states[step.state]} />
        </li>
      ))}
    </ol>
    {progress?.done && (
      <div className="df-actions">
        <Link to="/stores" search={{ store: storeId }} className="df-button df-button--primary">
          {words.open}
        </Link>
        <button type="button" className="df-button" onClick={onAgain}>
          {words.again}
        </button>
      </div>
    )}
  </section>
)
