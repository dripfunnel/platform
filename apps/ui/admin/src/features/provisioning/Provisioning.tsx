// States (?state=): loading, empty, error, denied, confirm. Without one the screen shows the
// API's page of signups whose setup is running, stuck or failed, newest first; see
// provisioningHarness.ts for what denied and readonly ask for.
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { JobAction, JobFilter, JobPage, ProvisioningJob } from '../../api/provisioning'
import { messages } from '../../messages'
import { EmptyState, ErrorState, LoadingState, ListHeader } from '@dripfunnel/shared/ui'
import { Pager } from '../common/Pager'
import { JobCard } from './JobCard'
import { JobFilters } from './JobFilters'
import type { ProvisioningScreenState } from './provisioningHarness'
import '@dripfunnel/shared/ui/list.css'
import './provisioning.css'

const words = messages.provisioning

export interface ProvisioningProps {
  page: JobPage | null
  filter: JobFilter
  forced: ProvisioningScreenState | null
  onFilterChange: (filter: JobFilter) => void
  onJob: (job: ProvisioningJob, action: JobAction) => void
  onReload: () => void
}

const ProvisioningHeader = () => <ListHeader level={words.level} title={words.title} sub={words.sub} />

export const ProvisioningLoading = () => (
  <div className="df-page df-list">
    <ProvisioningHeader />
    <LoadingState label={words.loading} rows={4} />
  </div>
)

export const ProvisioningError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ProvisioningHeader />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

// A role without the menu that opens the page anyway (FIRST-RELEASE.md §2).
const ProvisioningDenied = () => (
  <div className="df-page df-list">
    <ProvisioningHeader />
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

const isFiltered = (filter: JobFilter) => Object.values(filter).some((value) => value !== undefined)

export const Provisioning = ({ page, filter, forced, onFilterChange, onJob, onReload }: ProvisioningProps) => {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  if (forced === 'loading') return <ProvisioningLoading />
  if (forced === 'error') return <ProvisioningError onRetry={onReload} />
  if (!page) return <ProvisioningDenied />

  if (forced === 'empty' || (page.items.length === 0 && !isFiltered(filter) && !page.pageInfo.hasPreviousPage)) {
    return (
      <div className="df-page df-list">
        <ProvisioningHeader />
        <EmptyState title={words.empty.title} body={words.empty.body} />
      </div>
    )
  }

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <div className="df-page df-list">
      <ProvisioningHeader />
      <div className="df-list-toolbar">
        <JobFilters filter={filter} partners={page.partners} onChange={onFilterChange} />
        <p className="df-muted">{words.newestFirst}</p>
      </div>
      {page.items.length === 0 ? (
        <EmptyState
          title={words.noMatch.title}
          body={words.noMatch.body}
          action={
            <button type="button" className="df-button" onClick={() => onFilterChange({})}>
              {words.filters.clear}
            </button>
          }
        />
      ) : (
        <>
          <ul className="df-jobs" aria-label={words.listLabel}>
            {page.items.map((job) => (
              <li key={job.id}>
                <JobCard job={job} detailsOpen={open.has(job.id)} onToggleDetails={() => toggle(job.id)} onAction={(action) => onJob(job, action)} />
              </li>
            ))}
          </ul>
          <Pager
            label={words.pagerLabel}
            pageInfo={page.pageInfo}
            link={(cursor, label) => (
              <Link to="/provisioning" search={{ ...filter, ...cursor }} className="df-button">
                {label}
              </Link>
            )}
          />
        </>
      )}
    </div>
  )
}
