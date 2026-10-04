import { useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import type { BillingMoney } from '../../api/billing'
import { isPreLive } from '../../api/me'
import type { PartnerRole } from '../shell/partnerRoles'
import { harnessEnabled } from '../../harness'
import { Billing, BillingError, BillingLoading } from './Billing'
import { billingStates, type BillingState } from './billingHarness'
import { billingSample } from './billingSample'

const shellRoute = getRouteApi('/_app')

// Owner and Finance change who bills (§11); Support has no Billing at all (§2.1). The console's
// half only: when #201 gives Billing an API, the server refuses the same.
export const billingAccess = (role: PartnerRole): { denied: boolean; mayChange: boolean } => ({
  denied: role === 'partner-support',
  mayChange: role === 'partner-owner' || role === 'partner-finance',
})

// The sample for each harness state; null for the screen's own states.
export const sampleFor = (forced: BillingState | null): BillingMoney | null => {
  switch (forced) {
    case 'sample':
    case 'own':
      return billingSample
    case 'failedPayments':
      return { ...billingSample, payments: billingSample.payments.filter((payment) => payment.status === 'failed') }
    case 'payoutHeld':
      return { ...billingSample, nextPayout: { state: 'heldVerification' } }
    case 'firstPayout':
      return { ...billingSample, nextPayout: { state: 'first' }, payouts: [], payments: [], failed: [] }
    case 'stale':
      return { ...billingSample, staleSince: '2026-09-29T17:42:00.000Z' }
    default:
      return null
  }
}

export const BillingScreen = () => {
  // Who bills and whether the partner is Live are the shell's facts, read once for every screen.
  const { me, facts } = shellRoute.useLoaderData()
  const forced = useScreenState(billingStates, harnessEnabled)
  const router = useRouter()
  if (forced === 'loading') return <BillingLoading />
  if (forced === 'error') return <BillingError onRetry={() => void router.invalidate()} />
  return (
    <Billing
      mode={forced === 'own' ? 'own' : facts.billingMode}
      live={forced === 'prelive' ? false : sampleFor(forced) ? true : !isPreLive(facts.state)}
      money={sampleFor(forced)}
      partner={me.partner.name}
      product={me.partner.product}
      mayChange={billingAccess(me.role).mayChange}
      denied={forced === 'denied' || billingAccess(me.role).denied}
      onRefresh={() => void router.invalidate()}
    />
  )
}

export const BillingRouteError = () => {
  const router = useRouter()
  return <BillingError onRetry={() => void router.invalidate()} />
}
