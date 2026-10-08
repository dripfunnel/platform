import { ConfirmDialog, Toast, useCurrentStaffSession, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { loadMerchantDomains, recheckPartnerDomain, removePartnerDomain, type Address, type DomainKind, type MerchantDomain } from '../../api/domains'
import { staffSession } from '../../api/staffSession'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { Domains, DomainsError } from './Domains'
import { canRemoveAddress, removeFailure } from './domainLook'
import { domainsStates } from './domainsHarness'

const words = messages.domains
const domainsRoute = getRouteApi('/_app/domains')
const shellRoute = getRouteApi('/_app')
type Added = Extract<Address, { added: true }>

// Copying a record is the main thing done here; the toast says it worked (§9.1).
export const useCopy = (setToast: (text: string) => void) =>
  useCallback(
    (text: string) =>
      void Promise.resolve()
        .then(() => navigator.clipboard.writeText(text))
        .then(
          () => setToast(words.records.copied),
          () => setToast(words.records.copyFailed),
        ),
    [setToast],
  )

export const DomainsScreen = () => {
  const page = domainsRoute.useLoaderData()
  const forced = useScreenState(domainsStates, harnessEnabled)
  const { me } = shellRoute.useLoaderData()
  const session = useCurrentStaffSession(staffSession)
  const canRemove = canRemoveAddress(me.role, session?.state === 'open') && forced !== 'denied'
  const [removing, setRemoving] = useState<Added | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const router = useRouter()
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const [checking, setChecking] = useState<DomainKind | null>(null)
  const [extra, setExtra] = useState<{ items: readonly MerchantDomain[]; endCursor: string | null; more: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const onCopy = useCopy(setToast)
  // A reload (a re-check, Try again) starts the merchants' list from its first page again.
  useEffect(() => setExtra(null), [page])

  // The check runs out of the request; the page shows its answer once it is in.
  const onRecheck = (address: Extract<Address, { added: true }>) => {
    setChecking(address.kind)
    recheckPartnerDomain(address.kind)
      .then((result) => setToast(fill(result.ok ? words.recheckAsked : result.reason === 'TOO_SOON' ? words.tooSoon : words.recheckFailed, { host: address.host })))
      .catch(() => setToast(words.recheckFailed))
      .finally(() => {
        setChecking(null)
        void router.invalidate()
      })
  }

  const onRemove = () => {
    if (!removing) return
    const address = removing
    setRemoveError(null)
    removePartnerDomain(address.kind)
      .then((result) => {
        const failure = removeFailure(result, address.host)
        if (failure) return setRemoveError(failure)
        setRemoving(null)
        setToast(fill(words.remove.done, { host: address.host }))
        return router.invalidate()
      })
      .catch((error: unknown) => setRemoveError(removeFailure(error instanceof Error ? error : new Error(), address.host)))
  }

  const merchants = page.merchants
  const shown = extra ?? { items: merchants.items, endCursor: merchants.pageInfo.endCursor, more: merchants.pageInfo.hasNextPage }
  const onMore = () => {
    if (!shown.endCursor) return
    setBusy(true)
    loadMerchantDomains(shown.endCursor)
      .then((next) => setExtra({ items: [...shown.items, ...next.items], endCursor: next.pageInfo.endCursor, more: next.pageInfo.hasNextPage }))
      .catch(() => setToast(words.error.title))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Domains
        page={page}
        forced={forced}
        now={Date.now()}
        checking={checking}
        merchants={{ items: shown.items, more: shown.more, busy }}
        onRecheck={onRecheck}
        canRemove={canRemove}
        onRemove={(address) => {
          setRemoveError(null)
          setRemoving(address)
        }}
        onMore={onMore}
        onCopy={onCopy}
        onRetry={() => void router.invalidate()}
      />
      <ConfirmDialog
        open={removing !== null}
        danger
        title={fill(words.remove.title, { host: removing?.host ?? '' })}
        target={removing?.host ?? ''}
        consequence={removing ? fill(words.remove.body[removing.kind], { host: removing.host, sender: page.partner.fallbackAddress ?? '' }) : ''}
        confirmLabel={words.remove.confirm}
        cancelLabel={words.remove.cancel}
        error={removeError}
        onConfirm={onRemove}
        onCancel={() => setRemoving(null)}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const DomainsRouteError = () => {
  const router = useRouter()
  return <DomainsError onRetry={() => void router.invalidate()} />
}
