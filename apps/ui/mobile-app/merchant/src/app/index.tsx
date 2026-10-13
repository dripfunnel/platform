import { Redirect } from 'expo-router'
import { useSession } from '../session'

export default function Index() {
  const state = useSession()
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />
  if (state.status === 'signedIn' && state.acting === null) return <Redirect href="/choose-store" />
  return <Redirect href="/home" />
}
