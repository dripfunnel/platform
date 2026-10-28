import { Redirect } from 'expo-router'
import { Resource } from '../features/common/ui'
import { useLoad } from '../features/common/useLoad'
import { useSession } from '../session/SessionContext'

// The first-time profile is for a rider whose name or vehicle is still empty.
function Start() {
  const { state, reload } = useLoad(useSession().fetchRider)
  return <Resource state={state} onRetry={reload}>{(rider) => <Redirect href={rider.name?.trim() && rider.vehicleType ? '/home' : '/setup'} />}</Resource>
}

// Where the app starts: getting in, the first-time profile, or Home.
export default function Index() {
  return useSession().signedIn ? <Start /> : <Redirect href="/sign-in" />
}
