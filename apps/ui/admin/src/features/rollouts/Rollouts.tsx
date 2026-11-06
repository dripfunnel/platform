// States (?state=): loading, empty, error, denied, readonly, confirm; see rolloutsHarness.ts.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Rollout, RolloutPage } from '../../api/rollouts'
import { fill, formatTime, messages } from '../../messages'
import { ClickableRow, EmptyState, ErrorState, ListHeader, LoadingState, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import { Pager } from '../common/Pager'
import { RolloutStatePill, storeCounts } from './rolloutLook'
import type { RolloutsScreenState } from './rolloutsHarness'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'

const words = messages.rollouts

export interface RolloutsProps {
  page: RolloutPage | null
  forced: RolloutsScreenState | null
  canManage: boolean
  onStart: () => void
  onReload: () => void
}

const RolloutsHeader = ({ action }: { action?: ReactNode | undefined }) => <ListHeader level={words.level} title={words.title} sub={words.sub} action={action} />

export const RolloutsLoading = () => (
  <div className="df-page df-list">
    <RolloutsHeader />
    <LoadingState label={words.loading} rows={4} />
  </div>
)

export const RolloutsError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <RolloutsHeader />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

export const RolloutsDenied = () => (
  <div className="df-page df-list">
    <RolloutsHeader />
    <EmptyState
      title={words.denied.title}
      body={words.denied.body}
      action={
        <Link to="/" className="df-button">
          {words.denied.back}
        </Link>
      }
    />
  </div>
)

// While a rollout is paused no release starts its own (SAAS §10), which is why it is said first (#1312).
export const PausedBanner = ({ rollout, linked = true }: { rollout: Rollout; linked?: boolean }) => (
  <section className="df-state df-state--warning" role="status">
    <h2>{words.pausedBanner.title}</h2>
    <p>{fill(words.pausedBanner.body, { version: rollout.version, time: formatTime(rollout.startedAt) })}</p>
    {linked && (
      <p>
        <Link to="/rollouts/$rolloutId" params={{ rolloutId: rollout.id }} className="df-row-link">
          {fill(words.pausedBanner.open, { version: rollout.version })}
        </Link>
      </p>
    )}
  </section>
)

const RolloutRow = ({ rollout }: { rollout: Rollout }) => (
  <ClickableRow>
    <th scope="row">
      <div className="df-stack">
        <Link to="/rollouts/$rolloutId" params={{ rolloutId: rollout.id }} className="df-row-title">
          {rollout.version}
        </Link>
        {rollout.security && <span className="df-muted">{words.security}</span>}
      </div>
    </th>
    <td>
      <RolloutStatePill rollout={rollout} />
    </td>
    <td>{storeCounts(rollout)}</td>
    <td className="df-muted df-nowrap">{formatTime(rollout.startedAt)}</td>
    <td className="df-muted df-nowrap">{rollout.finishedAt ? formatTime(rollout.finishedAt) : words.notFinished}</td>
  </ClickableRow>
)

export const Rollouts = ({ page, forced, canManage, onStart, onReload }: RolloutsProps) => {
  if (forced === 'loading') return <RolloutsLoading />
  if (forced === 'error') return <RolloutsError onRetry={onReload} />
  if (!page) return <RolloutsDenied />

  const manage = canManage && forced !== 'readonly'
  const start = manage ? (
    <button type="button" className="df-button df-button--primary" onClick={onStart}>
      {words.start}
    </button>
  ) : undefined
  const paused = page.items.find((r) => r.state === 'paused') ?? null

  if (forced === 'empty' || (page.items.length === 0 && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <RolloutsHeader action={start} />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }

  return (
    <div className="df-page df-list">
      <RolloutsHeader action={start} />
      {paused && <PausedBanner rollout={paused} />}
      {!manage && <ReadOnlyNotice title={words.readonly.title} body={words.readonly.body} />}
      <div className="df-table-scroll" role="region" aria-label={words.listLabel} tabIndex={0}>
        <table className="df-table">
          <thead>
            <tr>
              {Object.values(words.columns).map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.items.map((rollout) => (
              <RolloutRow key={rollout.id} rollout={rollout} />
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        label={words.pagerLabel}
        pageInfo={page.pageInfo}
        link={(cursor, label) =>
          'after' in cursor ? (
            <Link to="/rollouts" search={{ after: cursor.after }} className="df-button">
              {label}
            </Link>
          ) : (
            <Link to="/rollouts" search={{}} className="df-button">
              {label}
            </Link>
          )
        }
      />
    </div>
  )
}

