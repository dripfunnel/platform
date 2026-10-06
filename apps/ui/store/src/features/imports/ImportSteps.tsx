import { fill, messages } from '../../messages'

const words = messages.imports.steps
const order = ['start', 'check', 'running', 'done'] as const
const labels = { start: words.choose, check: words.check, running: words.import, done: words.done }

/** CatImport's four numbered steps: the ones behind ticked, the current one strong. */
export const ImportSteps = ({ current }: { current: (typeof order)[number] }) => {
  const at = order.indexOf(current)
  return (
    <ol className="df-import-steps" aria-label={words.label}>
      {order.map((step, i) => {
        const state = i < at ? 'past' : i === at ? 'current' : 'next'
        return (
          <li key={step} className={`df-import-step df-import-step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="df-import-step-mark" aria-hidden="true">
              {state === 'past' ? '✓' : i + 1}
            </span>
            <span className="df-visually-hidden">{fill(state === 'past' ? words.finished : state === 'current' ? words.current : '{step}', { step: labels[step] })}</span>
            <span aria-hidden="true">{labels[step]}</span>
          </li>
        )
      })}
    </ol>
  )
}
