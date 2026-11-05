import { fill, formatCount, messages } from '../../messages'
import type { LiveRun } from './useStudioLive'

const words = messages.storefront.studio.live

const stepLabel = (s: LiveRun['steps'][number]): string => (s.step === 'repairing' ? fill(words.steps.repairing, { attempt: String(s.attempt ?? 1), of: String(s.of ?? 3) }) : words.steps[s.step])

/**
 * The live feed (PortalStorefront › studio `?state=working`, `?state=chat-streaming` and `?state=building`): a change's
 * steps, each ticked as the next arrives, and its summary; a build's page of how many over them; a chat answer word by word.
 */
export const StudioFeed = ({ run }: { run: LiveRun }) => {
  const last = run.steps.at(-1)
  const page = run.page
  if (run.chat && run.text)
    return (
      <>
        <p className="df-studio-stream" aria-hidden="true">
          {run.text}
          <span className="df-studio-caret" />
        </p>
        <span className="df-visually-hidden" role="status">
          {words.answering}
        </span>
      </>
    )
  return (
    <>
      {page && (
        <>
          <p className="df-studio-build-head">{fill(words.building, { index: formatCount(page.index), of: formatCount(page.of), title: page.titles[page.index - 1] ?? '' })}</p>
          <ol className="df-studio-build-pages" aria-label={words.buildPages}>
            {page.titles.map((title, i) => {
              const state = i < page.index - 1 ? 'done' : i === page.index - 1 ? 'now' : 'next'
              return (
                <li key={i} className={`df-studio-build-page df-studio-build-page--${state}`}>
                  <span aria-hidden="true">{title}</span>
                  <span className="df-visually-hidden">{fill(state === 'done' ? words.pageDone : state === 'now' ? words.pageNow : words.pageNext, { title })}</span>
                </li>
              )
            })}
          </ol>
        </>
      )}
      <ol className="df-studio-feed">
        {run.steps.map((s, i) => {
          const current = s === last
          return (
            <li key={i} className={current ? 'df-studio-step df-studio-step--current' : 'df-studio-step'} aria-current={current ? 'step' : undefined}>
              {current ? (
                <span className="df-studio-spin" aria-hidden="true" />
              ) : (
                <svg className="df-studio-tick" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="7" />
                  <path d="M5 8.2l2 2 4-4.4" />
                </svg>
              )}
              <span>{stepLabel(s)}</span>
            </li>
          )
        })}
      </ol>
      {run.text && <p className="df-studio-summary">{run.text}</p>}
    </>
  )
}
