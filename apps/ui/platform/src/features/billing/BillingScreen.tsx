import { reserveTab, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { invoicePdf, loadMoreInvoices, type Invoice } from '../../api/billing'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { usePaged } from '../common/paged'
import { Billing, BillingError, BillingLoading } from './Billing'
import { billingStates } from './billingHarness'
import { pdfToast } from './billingOutcome'
import { billingAccess } from './loadBilling'

const billingRoute = getRouteApi('/_app/billing')
const shellRoute = getRouteApi('/_app')
const words = messages.billing

export const BillingScreen = () => {
  const data = billingRoute.useLoaderData()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(billingStates, harnessEnabled)
  const router = useRouter()
  const [toast, setToast] = useState<string | null>(null)
  const money = data.refused ? null : data.money
  const invoices = usePaged(money?.invoices ?? null, (after) => loadMoreInvoices({ after }))

  if (forced === 'loading') return <BillingLoading />
  if (forced === 'error') return <BillingError onRetry={() => void router.invalidate()} />

  // The tab opens on the click, before Stripe's fresh link comes back, or the browser blocks it.
  const openPdf = (invoice: Invoice) => {
    const tab = reserveTab()
    invoicePdf(invoice.id)
      .then((result) => {
        if (result.ok) tab.go(result.url)
        else tab.close()
        const said = pdfToast(result, tab.blocked)
        if (said) setToast(said)
      })
      .catch(() => {
        tab.close()
        setToast(words.toasts.failed)
      })
  }

  return (
    <>
      <Billing money={money} invoices={invoices} denied={forced === 'denied' || data.refused} mayChange={billingAccess(me.role).mayChange} onRefresh={() => void router.invalidate()} onPdf={openPdf} onToast={setToast} />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  )
}

export const BillingRouteError = () => {
  const router = useRouter()
  return <BillingError onRetry={() => void router.invalidate()} />
}
