import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import type { StaffRole } from '../shell/staffRoles'
import { Dashboard } from './Dashboard'
import { DashboardLoading } from './DashboardLoading'
import { dashboardStates } from '@dripfunnel/shared/ui'

const dashboardRoute = getRouteApi('/_app/dashboard')
const shellRoute = getRouteApi('/_app')

// A courtesy only: the API refuses createPartner for every other role (ui/README §3).
const partnerCreators: readonly StaffRole[] = ['staff-super-admin', 'staff-partner-manager']

export const DashboardScreen = () => {
  const data = dashboardRoute.useLoaderData()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(dashboardStates, harnessEnabled)
  const navigate = dashboardRoute.useNavigate()
  const router = useRouter()
  // Loaded on a phone, until the shell reloads it for a wider screen.
  if (!data) return <DashboardLoading />
  return (
    <Dashboard
      data={data}
      forced={forced}
      canCreatePartner={partnerCreators.includes(me.role)}
      onPartnerChange={(partner) => void navigate({ search: partner ? { partner } : {} })}
      onReload={() => void router.invalidate()}
    />
  )
}
