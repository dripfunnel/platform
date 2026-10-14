import { Redirect } from 'expo-router'
import { seatOf, tabsFor } from '../nav'
import { useSession } from '../session'

export default function Index() {
  const state = useSession()
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />
  if (state.status !== 'signedIn' || state.acting === null) return <Redirect href="/choose-store" />
  // The first tab of the role's own tab bar: a supplier has no Home.
  return <Redirect href={`/${tabsFor(seatOf(state.acting))[0]?.route ?? 'more'}`} />
}
