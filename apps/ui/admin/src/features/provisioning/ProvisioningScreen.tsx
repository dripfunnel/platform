import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { jobActions, type JobAction, type JobFilter, type ProvisioningJob } from '../../api/provisioning'
import { messages } from '../../messages'
import { ConfirmDialog, useScreenState, Toast } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { jobDialog, type JobTarget } from './jobDialog'
import { Provisioning, ProvisioningError } from './Provisioning'
import { provisioningStates } from './provisioningHarness'
import { jobFailureWords, useJobRuns } from './useJobRuns'

const provisioningRoute = getRouteApi('/_app/provisioning')

interface Pending {
  job: ProvisioningJob
  action: JobAction
}

// ?state=confirm opens the first action a job on the page offers, so its dialog can be checked.
const firstAllowed = (jobs: readonly ProvisioningJob[]): Pending | null => {
  for (const job of jobs) {
    const action = jobActions.find((candidate) => job.actions[candidate]?.allowed)
    if (action) return { job, action }
  }
  return null
}

const targetOf = (job: ProvisioningJob): JobTarget => ({ name: job.store.name, code: job.store.code, owner: job.owner, step: job.step, attempts: job.attempts })

export const ProvisioningScreen = () => {
  const page = provisioningRoute.useLoaderData()
  const { partner, status, step, q } = provisioningRoute.useSearch()
  const forced = useScreenState(provisioningStates, harnessEnabled)
  const navigate = provisioningRoute.useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(() => (forced === 'confirm' && page ? firstAllowed(page.items) : null))
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const jobs = useMemo(() => page?.items ?? [], [page])
  const onOutcome = useCallback((_outcome: unknown, message: string) => setToast(message), [])
  const { run } = useJobRuns(jobs, onOutcome)

  // A new filter starts from the first page.
  const onFilterChange = useCallback((next: JobFilter) => void navigate({ search: next, replace: true }), [navigate])
  const filter: JobFilter = {
    ...(partner ? { partner } : {}),
    ...(status ? { status } : {}),
    ...(step ? { step } : {}),
    ...(q ? { q } : {}),
  }

  const onConfirm = (next: Pending, reason: string | null) => {
    setPending(null)
    run(next.action, next.job.id, targetOf(next.job), reason)
      .then(setToast)
      .catch((error: unknown) => setToast(jobFailureWords(error)))
  }

  const dialog = pending ? jobDialog(pending.action, targetOf(pending.job)) : null

  return (
    <>
      <Provisioning
        page={page}
        filter={filter}
        forced={forced}
        onFilterChange={onFilterChange}
        onJob={(job, action) => setPending({ job, action })}
        onReload={() => void router.invalidate()}
      />
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        target={dialog?.target ?? ''}
        consequence={dialog?.consequence ?? ''}
        confirmLabel={dialog?.confirmLabel ?? ''}
        cancelLabel={messages.provisioning.cancel}
        {...(dialog?.notes ? { notes: dialog.notes } : {})}
        {...(dialog?.reason ? { reason: dialog.reason } : {})}
        {...(dialog?.typeToConfirm ? { typeToConfirm: dialog.typeToConfirm } : {})}
        danger={dialog?.danger ?? false}
        onConfirm={(reason) => pending && onConfirm(pending, reason)}
        onCancel={() => setPending(null)}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const ProvisioningRouteError = () => {
  const router = useRouter()
  return <ProvisioningError onRetry={() => void router.invalidate()} />
}
