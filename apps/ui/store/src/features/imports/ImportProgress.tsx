import { Link } from '@tanstack/react-router'
import type { CatalogImport } from '../../api/imports'
import { fill, formatCount, messages, plural } from '../../messages'
import { useOnline } from '../common/online'
import { downloadCsv } from '../common/download'

const words = messages.imports

/** Import: the products done of those going in; leaving is fine, and offline it says it's paused, nothing half-saved. */
export const ImportRunning = ({ run }: { run: CatalogImport }) => {
  const online = useOnline()
  const total = run.ready
  const done = Math.min(run.done, total)
  return (
    <section className="df-import-card df-import-progress" aria-live="polite">
      <h2>{fill(plural(words.running.title, total), { count: formatCount(total) })}</h2>
      <div className="df-import-bar" role="progressbar" aria-label={words.running.progressLabel} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} />
      </div>
      <p>{fill(words.running.progress, { done: formatCount(done), total: formatCount(total) })}</p>
      {!online && (
        <p className="df-import-paused" role="status">
          <strong>{words.running.pausedTitle}</strong> {words.running.pausedBody}
        </p>
      )}
      <Link to="/products" className="df-button df-import-leave">
        {words.running.leave}
      </Link>
    </section>
  )
}

/** Done: what went in, what was skipped or couldn't be saved, photos still on their way, and the file of what didn't. */
export const ImportDone = ({ run, onRestart }: { run: CatalogImport; onRestart: () => void }) => {
  const d = words.done
  const skipped = run.products - run.ready
  const lines = [
    skipped > 0 && fill(plural(d.skipped, skipped), { count: formatCount(skipped) }),
    run.failed > 0 && fill(plural(d.failed, run.failed), { count: formatCount(run.failed) }),
    run.photosPending > 0 && fill(plural(d.photos, run.photosPending), { count: formatCount(run.photosPending) }),
  ].filter((line): line is string => typeof line === 'string')
  return (
    <section className="df-import-card df-import-progress df-import-done" aria-live="polite">
      <h2>{fill(d.title, { added: formatCount(run.created), updated: formatCount(run.updated) })}</h2>
      {lines.length > 0 && <p>{lines.join(' ')}</p>}
      {run.problemsCsv && (
        <button type="button" className="df-import-text-button df-import-link" onClick={() => downloadCsv(run.problemsCsv ?? '', words.check.problemsFile)}>
          {d.download}
        </button>
      )}
      <div className="df-import-row-actions">
        <Link to="/products" className="df-button df-button--primary">
          {d.view}
        </Link>
        <button type="button" className="df-button" onClick={onRestart}>
          {d.another}
        </button>
      </div>
    </section>
  )
}

/** A run the server ended (a lost Shopify connection): nothing more changed, and the reason as the API gives it. */
export const ImportStopped = ({ run, onRestart }: { run: CatalogImport; onRestart: () => void }) => (
  <section className="df-import-card df-import-progress" role="alert">
    <h2>{words.stopped.title}</h2>
    <p>{run.problems.find((p) => p.line === 0)?.message ?? words.stopped.body}</p>
    <div className="df-import-row-actions">
      <button type="button" className="df-button df-button--primary" onClick={onRestart}>
        {words.done.another}
      </button>
    </div>
  </section>
)
