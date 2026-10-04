import { Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { addPartnerDomain, loadPartnerDomains, recheckPartnerDomain, type Address, type DomainKind } from '../../api/domains'
import { isApiError } from '../../api/client'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { AddDomain, AddDomainDenied, AddDomainError, AddDomainLoading, AddressStep, AllAddressesSet, CheckStep, RecordsStep, type Step } from './AddDomain'
import { exampleFor, firstKind, hostFrom, refusalText, zoneIn } from './addDomainRules'
import { addDomainStates } from './domainsHarness'
import { useCopy } from './DomainsScreen'

const words = messages.domains.new
const addRoute = getRouteApi('/_app/domains_/new')

type Added = Extract<Address, { added: true }>

// §9.2's three steps on the Platform API: Continue adds the address, which gives it its records;
// "Check now" queues the check; the answer is the address as the API then reads it.
export const AddDomainScreen = () => {
  const domains = addRoute.useLoaderData()
  const { k } = addRoute.useSearch()
  const forced = useScreenState(addDomainStates, harnessEnabled)
  const router = useRouter()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [kind, setKind] = useState<DomainKind>(() => firstKind(domains.addresses, k))
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<{ address: Added; apex: boolean } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const onCopy = useCopy(setToast)

  if (forced === 'loading') return <AddDomainLoading />
  if (forced === 'error') return <AddDomainError onRetry={() => void router.invalidate()} />
  const free = domains.addresses.filter((a) => !a.added)
  if (step === 1 && free.length === 0) return <AllAddressesSet />
  if (forced === 'denied' || !domains.canAdd) return <AddDomainDenied />

  const reread = async (): Promise<Added | null> => {
    const fresh = (await loadPartnerDomains()).addresses.find((a): a is Added => a.kind === kind && a.added)
    return fresh ?? null
  }

  const zone = zoneIn(domains.addresses)

  const onContinue = () => {
    const host = hostFrom(typed)
    if (!host) return setError(refusalText('INVALID_INPUT', exampleFor(kind, zone)))
    setBusy(true)
    addPartnerDomain(kind, host)
      .then(async (result) => {
        if (!result.ok) return setError(refusalText(result.reason, exampleFor(kind, zone)))
        // Saved, whatever happens next: without its records here, Domains shows them.
        const address = await reread().catch(() => null)
        if (!address) return void navigate({ to: '/domains' })
        setAdded({ address, apex: result.apex })
        setStep(2)
      })
      .catch((failure: unknown) => (isApiError(failure) && failure.code === 'FORBIDDEN' ? setError(messages.domains.addRefused) : setError(words.failed)))
      .finally(() => setBusy(false))
  }

  // The next address starts afresh, on the first kind still free once this one counts as added.
  const onNext = () => {
    setStep(1)
    setKind(firstKind(domains.addresses.map((a) => (a.kind === kind ? { kind, added: false as const } : a)).filter((a) => a.kind !== kind), undefined))
    setTyped('')
    setError(null)
    setAdded(null)
    setNote(null)
    void router.invalidate()
  }

  // The first check is queued when the address is added, so a press within the minute still waits on it.
  const onCheck = () => {
    if (!added) return
    setBusy(true)
    recheckPartnerDomain(kind)
      .then(async (result) => {
        setNote(!result.ok && result.reason === 'TOO_SOON' && step === 3 ? fill(messages.domains.tooSoon, { host: added.address.host }) : null)
        const address = await reread()
        if (address) setAdded({ ...added, address })
        setStep(3)
      })
      .catch(() => setToast(messages.domains.recheckFailed))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <AddDomain step={step}>
        {step === 1 || !added ? (
          <AddressStep
            addresses={domains.addresses}
            zone={zone}
            kind={kind}
            typed={typed}
            error={error}
            busy={busy}
            onKind={(next) => {
              setKind(next)
              setError(null)
            }}
            onType={(next) => {
              setTyped(next)
              setError(null)
            }}
            onContinue={onContinue}
          />
        ) : step === 2 ? (
          <RecordsStep address={added.address} apex={added.apex} busy={busy} onCopy={onCopy} onCheck={onCheck} />
        ) : (
          <CheckStep address={added.address} more={free.some((a) => a.kind !== kind)} note={note} busy={busy} onCheck={onCheck} onNext={onNext} />
        )}
      </AddDomain>
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const AddDomainRouteError = () => {
  const router = useRouter()
  return <AddDomainError onRetry={() => void router.invalidate()} />
}
