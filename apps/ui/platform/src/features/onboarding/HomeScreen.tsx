import { parseScreenState, useCurrentStaffSession } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouterState } from '@tanstack/react-router'
import { onboardingFor, setupVariants } from '../../api/onboarding'
import { staffSession } from '../../api/staffSession'
import { harnessEnabled } from '../../harness'
import { DashboardScreen } from '../dashboard/DashboardScreen'
import { LiveMoment } from './LiveMoment'
import { Onboarding } from './Onboarding'

const shellRoute = getRouteApi('/_app')

// Home is the checklist until the partner is Live (FIRST-RELEASE §4), then the Dashboard (#114),
// with the Live moment once. ?setup=dripfunnel and ?moment=live are the harness's.
export const HomeScreen = () => {
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const search = new URLSearchParams(searchStr)
  const setupBy = (harnessEnabled && parseScreenState(search.get('setup'), setupVariants)) || 'partner'
  const session = useCurrentStaffSession(staffSession)
  const staffSetup = session?.kind === 'setup'
  if (me.partner.state === 'live') {
    return (
      <>
        {harnessEnabled && search.get('moment') === 'live' && <LiveMoment product={me.partner.product} host={me.partner.host} />}
        <DashboardScreen />
      </>
    )
  }
  // Keyed so a harness change of state or setup redraws from the fixture instead of stale state.
  return <Onboarding key={`${me.partner.state}-${setupBy}`} me={me} onboarding={onboardingFor(me.partner.state, setupBy)} staffSetup={staffSetup} welcome={setupBy === 'dripfunnel'} />
}
