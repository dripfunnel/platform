import { parseScreenState, useCurrentStaffSession } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouterState } from '@tanstack/react-router'
import { isPreLive } from '../../api/me'
import { staffSession } from '../../api/staffSession'
import { harnessEnabled } from '../../harness'
import { DashboardScreen } from '../dashboard/DashboardScreen'
import { LiveMoment } from './LiveMoment'
import { Onboarding } from './Onboarding'

const shellRoute = getRouteApi('/_app')
const dashboardRoute = getRouteApi('/_app/dashboard')

// Home is the checklist until the partner is Live (FIRST-RELEASE §4), then the Dashboard (#114),
// with the Live moment once. ?setup=dripfunnel and ?moment=live are the harness's: the API says
// neither whether this is the Owner's first sign-in after staff set up nor whether Live is new.
export const HomeScreen = () => {
  const { me } = shellRoute.useLoaderData()
  const { onboarding } = dashboardRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const search = new URLSearchParams(searchStr)
  const session = useCurrentStaffSession(staffSession)
  const state = me.partner.state
  if (!isPreLive(state) || !onboarding) {
    return (
      <>
        {harnessEnabled && search.get('moment') === 'live' && <LiveMoment product={me.partner.product} host={me.partner.host ?? ''} />}
        <DashboardScreen />
      </>
    )
  }
  const welcome = harnessEnabled && parseScreenState(search.get('setup'), ['dripfunnel'] as const) === 'dripfunnel'
  return <Onboarding me={me} state={state} onboarding={onboarding} staffSetup={session?.kind === 'setup'} welcome={welcome} />
}
