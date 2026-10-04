import { reserveTab, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { invoicePdf, loadMoreInvoices, loadMorePayments, loadMorePayouts, setBillingMode, type Invoice } from '../../api/billing'
import { isPreLive } from '../../api/me'
import type { BillingMode } from '../../api/stores'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { usePaged } from '../common/paged'
import { Billing, BillingError, BillingLoading } from './Billing'
import { billingStates } from './billingHarness'
import { billingAccess } from './loadBilling'

const billingRoute = getRouteApi('/_app/billing')
const shellRoute = getRouteApi('/_app')
const words = messages.billing

export const BillingScreen = () => {
  const data = billingRoute.useLoaderData()
  // Who bills and whether the partner is Live are the shell's facts, read once for every screen.
  const { me, facts } = shellRoute.useLoaderData()
  const forced = useScreenState(billingStates, harnessEnabled)
  const router = useRouter()
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const money = data.refused ? null : data.money
  const payments = usePaged(money?.payments ?? null, (after) => loadMorePayments({ after }))
  const payouts = usePaged(money?.payouts ?? null, (after) => loadMorePayouts({ after }))
  const invoices = usePaged(money?.invoices ?? null, (after) => loadMoreInvoices({ after }))

  if (forced === 'loading') return <BillingLoading />
  if (forced === 'error') return <BillingError onRetry={() => void router.invalidate()} />

  const mode: BillingMode = forced === 'own' ? 'own' : facts.billingMode

  // §11.4: the API refuses the same roles; an answer it gives is worded, anything else is "try again".
  const changeMode = (next: BillingMode) => {
    if (busy) return
    setBusy(true)
    setBillingMode(next)
      .then(async (result) => {
        if (!result.ok) return setToast(words.toasts.failed)
        setToast(fill(words.toasts.modeChanged, { mode: words.settings[next].label }))
        await router.invalidate()
      })
      .catch(() => setToast(words.toasts.failed))
      .finally(() => setBusy(false))
  }

  // The tab opens on the click, before Stripe's fresh link comes back, or the browser blocks it.
  const openPdf = (invoice: Invoice) => {
    const tab = reserveTab()
    invoicePdf(invoice.id)
      .then((result) => {
        if (!result.ok) {
          tab.close()
          return setToast(words.toasts.noPdf)
        }
        tab.go(result.url)
        if (tab.blocked) setToast(words.toasts.popupBlocked)
      })
      .catch(() => {
        tab.close()
        setToast(words.toasts.failed)
      })
  }

  return (
    <>
      <Billing
        mode={mode}
        live={forced === 'prelive' ? false : !isPreLive(facts.state)}
        money={money}
        payments={payments}
        payouts={payouts}
        invoices={invoices}
        partner={me.partner.name}
        product={me.partner.product}
        mayChange={billingAccess(me.role).mayChange}
        changing={busy}
        denied={forced === 'denied' || data.refused}
        onRefresh={() => void router.invalidate()}
        onChangeMode={changeMode}
        onPdf={openPdf}
      />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  )
}

export const BillingRouteError = () => {
  const router = useRouter()
  return <BillingError onRetry={() => void router.invalidate()} />
}
