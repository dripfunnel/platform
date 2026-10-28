import { Redirect } from 'expo-router'
import { Resource } from '../features/common/ui'
import { useLoad } from '../features/common/useLoad'
import { hasAsked, pushIsSetUp } from '../push/push'
import { useSession } from '../session/SessionContext'

// The first-time profile is for a rider whose name or vehicle is still empty.
function Start() {
  const { fetchRider } = useSession()
  const { state, reload } = useLoad(async () => ({ rider: await fetchRider(), asked: !pushIsSetUp() || (await hasAsked().catch(() => true)) }))
  return <Resource state={state} onRetry={reload}>{({ rider, asked }) => <Redirect href={!rider.name?.trim() || !rider.vehicleType ? '/setup' : asked ? '/home' : '/notifications'} />}</Resource>
}

// Where the app starts: getting in, the first-time profile, or Home.
export default function Index() {
  return useSession().signedIn ? <Start /> : <Redirect href="/sign-in" />
}
