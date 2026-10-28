import { useEffect, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { fetchMinimumBuild } from '../api/minimumBuild'
import { useSession } from '../session/SessionContext'
import { installedBuild } from './installedBuild'
import { UpdateRequired } from './UpdateRequired'

// A build below the store's minimum gets the Update required screen instead of the app. An API that can't be reached, or answers
// no minimum, lets the app run: a rider with no signal must still deliver (docs/mobile-app/delivery/FIRST-RELEASE.md §1).
export function UpdateGate({ children }: { children: ReactNode }) {
  const { client, host } = useSession()
  const [minimum, setMinimum] = useState<number | null>(null)

  useEffect(() => {
    const check = () => void fetchMinimumBuild(client).then(setMinimum, () => undefined)
    check()
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && check())
    return () => subscription.remove()
  }, [client])

  const installed = installedBuild()
  if (installed !== null && minimum !== null && installed < minimum) return <UpdateRequired host={host} />
  return <>{children}</>
}
