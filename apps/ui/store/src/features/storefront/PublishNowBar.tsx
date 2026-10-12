import { isApiError } from '@dripfunnel/shared/graphql'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { StorefrontMeters } from '../../api/storefront'
import { fill, formatTime, messages, plural } from '../../messages'
import { refusalIn } from '../common/refusal'
import { publishPollMs, publishProgress, publishReadTries } from './studioRules'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.publishNow
const refusal = refusalIn(words.refused)

export interface PublishNowBarProps {
  catalogue: StorefrontMeters['catalogue']
  canEdit: boolean
  canUpgrade: boolean
  api: StorefrontApi
  /** The publish followed, kept in the address so a reload keeps following it. */
  run: string | null
  onRun: (id: string | null) => void
  /** The publish ended: read the design and the meters again. */
  onDone: (toast: string | null) => void
}

/** The catalogue's "Publish now" bar (FIRST-RELEASE §14, not drawn): styled like the draft notice, shown only while changes wait. */
export const PublishNowBar = ({ catalogue, canEdit, canUpgrade, api, run, onRun, onDone }: PublishNowBarProps) => {
  const [error, setError] = useState<string | null>(null)
  const [lost, setLost] = useState(false)
  const [checks, setChecks] = useState(0)
  const working = useRef(false)

  // The press is read again until it ends; only the newest answer for the run followed lands.
  useEffect(() => {
    if (!run) return
    let current = true
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    setLost(false)
    const read = () =>
      api.loadPublishRun(run).then(
        (answer) => {
          if (!current) return
          failures = 0
          if (answer && publishProgress(answer.step)) return void (timer = setTimeout(() => void read(), publishPollMs))
          onRun(null)
          if (answer?.step === 'failed' || answer?.step === 'rolled_back') setError(words.failed)
          onDone(answer?.step === 'live' ? words.done : null)
        },
        (e: unknown) => {
          if (!current) return
          failures += 1
          // The studio's rule: a refused read, or one that keeps failing, stops asking but keeps the press followed.
          if (isApiError(e, 'SESSION_ENDED') || isApiError(e, 'FORBIDDEN') || failures >= publishReadTries) return setLost(true)
          timer = setTimeout(() => void read(), publishPollMs)
        },
      )
    void read()
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, run, onRun, onDone, checks])

  if (!catalogue.waiting && !run && !error) return null
  const since = catalogue.since ? formatTime(catalogue.since) : ''
  const what = catalogue.changedKinds.length === 1 && catalogue.changedKinds[0] === 'products' ? fill(plural(words.products, catalogue.changedProducts), { count: String(catalogue.changedProducts), time: since }) : fill(words.changed, { time: since })
  const out = catalogue.pressesLeft === 0
  const presses = catalogue.pressesLeft !== null && catalogue.pressesAllowed !== null ? (out ? words.none : fill(plural(words.presses, catalogue.pressesLeft), { left: String(catalogue.pressesLeft), allowed: String(catalogue.pressesAllowed) })) : null
  const press = () => {
    if (working.current) return
    working.current = true
    setError(null)
    api.publishNow().then(
      (id) => {
        working.current = false
        onRun(id)
      },
      (e: unknown) => {
        working.current = false
        setError(refusal(e))
      },
    )
  }

  return (
    <div className="df-sf-draft df-sf-publish-now">
      {catalogue.waiting && (
        <p>
          <span>{what}</span> {presses && <span>{presses}</span>} {catalogue.nextAutomaticPublishAt && <span>{fill(words.next, { time: formatTime(catalogue.nextAutomaticPublishAt) })}</span>}
        </p>
      )}
      {run && lost ? (
        <>
          <p className="df-sf-problem" role="alert">
            {words.lost}
          </p>
          <button type="button" className="df-button df-sf-draft-button" onClick={() => setChecks((n) => n + 1)}>
            {words.checkAgain}
          </button>
        </>
      ) : run ? (
        <span role="status" className="df-sf-publish-now-working">
          {words.working}
        </span>
      ) : (
        canEdit &&
        catalogue.waiting &&
        (out ? (
          canUpgrade && (
            <Link className="df-button df-sf-draft-button" to="/billing">
              {words.seePlans}
            </Link>
          )
        ) : (
          <button type="button" className="df-button df-sf-draft-button df-sf-draft-button--strong" onClick={press}>
            {words.button}
          </button>
        ))
      )}
      {error && (
        <p className="df-sf-problem" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
