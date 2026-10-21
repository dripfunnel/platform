import { fill, messages } from '../../messages'

export interface Bar {
  label: string
  // The value as the API gave it, already in words (a count, or an amount with its currency).
  text: string
  // The size to draw it at, against the others: drawing only, never shown as a figure.
  size: number
}

// The API's series as bars (§10), navy as the style guide's charts; the numbers above them are the API's.
export const Bars = ({ title, bars }: { title: string; bars: readonly Bar[] }) => {
  const largest = Math.max(1, ...bars.map((bar) => bar.size))
  return (
    <figure className="df-report-chart">
      <figcaption>{title}</figcaption>
      {/* Screen readers read the list below; the bars are its drawing. */}
      <ul className="df-visually-hidden" aria-label={fill(messages.reports.chartLabel, { title })}>
        {bars.map((bar) => (
          <li key={bar.label}>
            {bar.label}: {bar.text}
          </li>
        ))}
      </ul>
      <div className="df-report-bars" aria-hidden="true">
        {bars.map((bar) => (
          <div key={bar.label} className="df-report-bar">
            <span className="df-report-bar-value">{bar.text}</span>
            <div className="df-report-bar-fill" style={{ height: `${Math.max(2, (bar.size / largest) * 100)}%` }} />
            <span className="df-report-bar-label">{bar.label}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}
