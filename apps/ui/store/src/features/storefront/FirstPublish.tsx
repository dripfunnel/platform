import { useCallback, useState } from 'react'
import type { PublishRun } from '../../api/studio'
import { fill, messages } from '../../messages'
import type { StorefrontApi } from './storefrontApi'
import { publishProgress, refusedText } from './studioRules'
import { usePublishRun } from './usePublishRun'
import './studio.css'

const words = messages.storefront.studio.publish
// The studio's own "lost" line speaks of the studio, so this one is the Publish now bar's.
const lostWords = messages.storefront.publishNow

export interface FirstPublishProps {
  api: StorefrontApi
  run: string | null
  onRun: (id: string | null) => void
  /** The publish ended: the toast when it went live, then the overview read again. */
  onDone: (toast: string | null) => void
}

/** A store's first publish followed outside the studio (#1229): the studio's steps, then its result. */
export const FirstPublish = ({ api, run, onRun, onDone }: FirstPublishProps) => {
  const [answer, setAnswer] = useState<PublishRun | null>(null)
  const ended = useCallback(
    (end: PublishRun | null) => {
      setAnswer(end)
      onRun(null)
      onDone(end?.step === 'live' ? fill(words.live, { number: String(end.version ?? '') }) : null)
    },
    [onRun, onDone],
  )
  const { lost, checkAgain } = usePublishRun(api, run, { onProgress: setAnswer, onEnd: ended })

  if (run && lost)
    return (
      <div className="df-studio-refused" role="alert">
        <span>{lostWords.lost}</span>
        <button type="button" className="df-button" onClick={checkAgain}>
          {lostWords.checkAgain}
        </button>
      </div>
    )
  const progress = run ? publishProgress(answer?.id === run ? answer.step : 'queued') : null
  if (progress)
    return (
      <div className="df-studio-progress" role="status">
        <span className="df-studio-progress-bar" aria-hidden="true">
          <span style={{ width: `${progress.percent}%` }} />
        </span>
        <span>{progress.text}</span>
      </div>
    )
  if (run || answer?.step !== 'failed') return null
  return (
    <div className="df-studio-refused" role="alert">
      <strong>{fill(words.refusedTitle, { number: String(answer.version ?? 1) })}</strong>
      <span>{refusedText(answer)}</span>
    </div>
  )
}
