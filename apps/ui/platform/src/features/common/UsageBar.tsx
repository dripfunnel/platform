import './usage.css'

// The API's percent of a limit, as a bar: warning from 80%, danger at 100% (FIRST-RELEASE.md §5, §6.3).
export const UsageBar = ({ percent }: { percent: number }) => (
  <span className="df-usage-bar" aria-hidden="true">
    <span className={percent >= 100 ? 'df-usage-bar-fill df-usage-bar-fill--full' : percent >= 80 ? 'df-usage-bar-fill' : 'df-usage-bar-fill df-usage-bar-fill--ok'} style={{ width: `${Math.min(100, percent)}%` }} />
  </span>
)
