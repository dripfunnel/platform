import './states.css'

export interface ErrorDetails {
  label: string
  codeLabel: string
  code: string
  requestIdLabel: string
  requestId?: string
}

export interface ErrorStateProps {
  title: string
  body: string
  details?: ErrorDetails
  retry?: { label: string; onRetry: () => void }
}

// Details are the API's stable code and the request id only, never ApiError.message: a raw
// message can carry internals (docs/code/WORKFLOW.md §7). Anything not shaped like a code or an
// id is not shown, so passing a message by mistake leaks nothing.
const codePattern = /^[A-Z][A-Z0-9_]*$/
const requestIdPattern = /^[A-Za-z0-9-]{1,64}$/

export const ErrorState = ({ title, body, details, retry }: ErrorStateProps) => (
  <section className="df-state df-state--danger" role="alert">
    <h2>{title}</h2>
    <p>{body}</p>
    {details && (
      <details>
        <summary>{details.label}</summary>
        <dl className="df-details">
          <dt>{details.codeLabel}</dt>
          <dd>
            <code>{codePattern.test(details.code) ? details.code : 'UNKNOWN'}</code>
          </dd>
          {details.requestId !== undefined && requestIdPattern.test(details.requestId) && (
            <>
              <dt>{details.requestIdLabel}</dt>
              <dd>
                <code>{details.requestId}</code>
              </dd>
            </>
          )}
        </dl>
      </details>
    )}
    {retry && (
      <div className="df-actions">
        <button type="button" className="df-button" onClick={retry.onRetry}>
          {retry.label}
        </button>
      </div>
    )}
  </section>
)
