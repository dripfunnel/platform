// States (?state=): loading, empty, error, denied, readonly, confirm; see rolloutsHarness.ts.
import { Link } from '@tanstack/react-router'
import { actionsFor, storeUpgradeStates, type RolloutAction, type RolloutDetail as Detail, type RolloutStore, type StoreUpgradeState } from '../../api/rollouts'
import { fill, formatTime, messages } from '../../messages'
import { ActionControl, ClickableRow, EmptyState, ErrorState, FilterSelect, LoadingState, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import { Pager } from '../common/Pager'
import { PausedBanner, RolloutsDenied } from './Rollouts'
import { errorText, RolloutStatePill, storeCounts, StoreStatePill } from './rolloutLook'
import type { RolloutsScreenState } from './rolloutsHarness'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/list.css'

const words = messages.rollouts
const detail = words.detail
const stateOptions = storeUpgradeStates.map((value) => ({ value, label: words.storeStates[value] }))

export interface RolloutDetailProps {
  page: Detail | null | 'denied'
  status: StoreUpgradeState | undefined
  forced: RolloutsScreenState | null
  canManage: boolean
  onStatus: (status: StoreUpgradeState | undefined) => void
  onAction: (action: RolloutAction) => void
  onReload: () => void
}

const Breadcrumb = ({ current }: { current?: string }) => (
  <nav aria-label={detail.back} className="df-breadcrumb">
    <Link to="/rollouts">{detail.back}</Link>
    {current && (
      <>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{current}</span>
      </>
    )}
  </nav>
)

export const RolloutDetailLoading = () => (
  <div className="df-page">
    <Breadcrumb />
    <LoadingState label={words.loading} rows={4} />
  </div>
)

export const RolloutDetailError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page">
    <Breadcrumb />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const NotFound = () => (
  <div className="df-page">
    <Breadcrumb />
    <EmptyState
      title={detail.notFound.title}
      body={detail.notFound.body}
      action={
        <Link to="/rollouts" className="df-button">
          {detail.notFound.back}
        </Link>
      }
    />
  </div>
)

const StoreRow = ({ store }: { store: RolloutStore }) => (
  <ClickableRow>
    <th scope="row">
      <div className="df-stack">
        <Link to="/stores/$storeId" params={{ storeId: store.storeId }} className="df-row-title">
          {store.storeName}
        </Link>
        <code className="df-muted">{store.storeCode}</code>
      </div>
    </th>
    <td>{store.partnerName}</td>
    <td>{store.canary ? detail.canary : detail.wave}</td>
    <td>
      <code>{store.fromVersion}</code>
    </td>
    <td>
      <StoreStatePill state={store.state} />
    </td>
    <td>{store.error ? errorText(store.error) : detail.noError}</td>
    <td className="df-muted df-nowrap">{store.finishedAt ? formatTime(store.finishedAt) : words.notFinished}</td>
  </ClickableRow>
)

export const RolloutDetail = ({ page, status, forced, canManage, onStatus, onAction, onReload }: RolloutDetailProps) => {
  if (forced === 'loading') return <RolloutDetailLoading />
  if (forced === 'error') return <RolloutDetailError onRetry={onReload} />
  if (page === 'denied') return <RolloutsDenied />
  if (!page) return <NotFound />

  const { rollout, stores } = page
  const manage = canManage && forced !== 'readonly'
  const actions = manage ? actionsFor(rollout.state) : []
  const items = forced === 'empty' ? [] : stores.items

  return (
    <div className="df-page">
      <header className="df-detail-header">
        <Breadcrumb current={rollout.version} />
        <div className="df-detail-title">
          <div className="df-detail-heading">
            <p className="df-eyebrow">{rollout.security ? `${detail.level} · ${words.security}` : detail.level}</p>
            <div className="df-detail-name">
              <h1 className="df-page-title">{fill(detail.title, { version: rollout.version })}</h1>
              <RolloutStatePill rollout={rollout} />
            </div>
          </div>
        </div>
        <dl className="df-detail-meta">
          <div>
            <dt>{detail.reason}</dt>
            <dd>{rollout.reason}</dd>
          </div>
          <div>
            <dt>{detail.started}</dt>
            <dd>{formatTime(rollout.startedAt)}</dd>
          </div>
          <div>
            <dt>{detail.finished}</dt>
            <dd>{rollout.finishedAt ? formatTime(rollout.finishedAt) : words.notFinished}</dd>
          </div>
          <div>
            <dt>{detail.progress}</dt>
            <dd>{storeCounts(rollout)}</dd>
          </div>
        </dl>
        {actions.length > 0 && (
          <div className="df-detail-actions" role="group" aria-label={fill(detail.title, { version: rollout.version })}>
            {actions.map((action) => (
              <ActionControl key={action} label={words.actions[action]} refusal={null} primary={action === 'resume'} danger={action === 'rollBack'} onRun={() => onAction(action)} />
            ))}
          </div>
        )}
      </header>
      {rollout.state === 'paused' && <PausedBanner rollout={rollout} linked={false} />}
      {!manage && <ReadOnlyNotice title={words.readonly.title} body={words.readonly.body} />}
      <section className="df-list" aria-labelledby="rollout-stores">
        <h2 id="rollout-stores">{detail.storesTitle}</h2>
        <form role="search" aria-label={detail.filter} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
          <FilterSelect label={detail.filter} anyLabel={detail.allStates} options={stateOptions} value={status} onChange={onStatus} />
        </form>
        {items.length === 0 ? (
          <EmptyState title={detail.noStoresTitle} body={detail.noStoresBody} />
        ) : (
          <div className="df-table-scroll" role="region" aria-label={detail.storesLabel} tabIndex={0}>
            <table className="df-table">
              <thead>
                <tr>
                  {Object.values(detail.columns).map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((store) => (
                  <StoreRow key={store.storeId} store={store} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          label={words.storesPagerLabel}
          pageInfo={stores.pageInfo}
          link={(cursor, label) => (
            <Link to="/rollouts/$rolloutId" params={{ rolloutId: rollout.id }} search={{ status, ...cursor }} className="df-button">
              {label}
            </Link>
          )}
        />
      </section>
    </div>
  )
}
