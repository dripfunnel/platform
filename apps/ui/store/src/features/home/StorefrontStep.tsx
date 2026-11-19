import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { harnessSearch } from '../../harness'
import { fill, messages } from '../../messages'
import { chooseRefusal } from '../storefront/overviewView'
import type { StorefrontPhase, StorefrontSetup } from './homeView'

const words = messages.home.setup.storefront

interface StorefrontStepProps {
  label: string
  site: StorefrontSetup
  phase: Exclude<StorefrontPhase, 'done'>
  onCreate: () => Promise<void>
}

/** "Create your storefront" (FIRST-RELEASE §5): the first site from the category's template, then the studio to publish it. */
export const StorefrontStep = ({ label, site, phase, onCreate }: StorefrontStepProps) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = () => {
    setBusy(true)
    setError(null)
    onCreate().then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false)
        setError(chooseRefusal(e))
      },
    )
  }
  const note = {
    locked: words.locked,
    ready: site.template ? fill(words.template, { name: site.template.name }) : null,
    failed: words.failed,
    creating: words.creating,
    open: words.ready,
  }[phase]

  return (
    <div className="df-home-step-choices">
      <span className="df-home-step-mark" aria-hidden="true" />
      <span className="df-home-step-text">
        <span className="df-home-step-label">{label}</span>
        {note && (
          <span className="df-home-step-note" role={phase === 'creating' ? 'status' : undefined}>
            {phase === 'creating' && <span className="df-home-step-spinner" aria-hidden="true" />}
            {note}
          </span>
        )}
        {error && (
          <span className="df-home-step-owner" role="alert">
            {error}
          </span>
        )}
      </span>
      <span className="df-home-step-actions">
        {phase === 'open' ? (
          <Link className="df-button df-button--primary" to="/storefront" search={(prev) => ({ ...harnessSearch(prev), view: 'studio' as const })}>
            {words.open}
          </Link>
        ) : (
          <button type="button" className="df-button df-button--primary" disabled={phase === 'locked' || phase === 'creating' || busy} onClick={create}>
            {phase === 'creating' || busy ? words.creatingCta : words.create}
          </button>
        )}
      </span>
    </div>
  )
}
