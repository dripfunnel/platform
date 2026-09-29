import './states.css'

export interface ErrorStateProps {
  title: string
  body: string
  detailsLabel: string
  details?: string
  retry?: { label: string; onRetry: () => void }
}

export const ErrorState = ({ title, body, detailsLabel, details, retry }: ErrorStateProps) => (
  <section className="df-state df-state--danger" role="alert">
    <h2>{title}</h2>
    <p>{body}</p>
    {details && (
      <details>
        <summary>{detailsLabel}</summary>
        <pre>{details}</pre>
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
