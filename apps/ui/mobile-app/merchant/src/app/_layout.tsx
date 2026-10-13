// First, so the Intl polyfills are in place before anything formats (ARCHITECTURE.md §4 step 1).
import '../intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { BrandProvider } from '../brand/BrandProvider'
import { t } from '../messages'
import { useSession } from '../session'
import { SessionProvider } from '../session/SessionProvider'
import { useTheme } from '../theme'

// Who may see which screen follows the session (ARCHITECTURE.md §4 steps 4–5): signed out sees getting in; signed in with
// no store acting sees the chooser; a store acting sees the app. A change of session moves the person by itself.
function Routes() {
  const state = useSession()
  const { colors } = useTheme()
  const signedOut = state.status === 'signedOut'
  const choosing = state.status === 'signedIn' && state.acting === null
  const inStore = state.status === 'signedIn' && state.acting !== null
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={choosing}>
        <Stack.Screen name="choose-store" />
      </Stack.Protected>
      <Stack.Protected guard={inStore}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" options={{ headerShown: true, title: t('profile.title'), headerStyle: { backgroundColor: colors.side }, headerTintColor: colors.sideText }} />
      </Stack.Protected>
    </Stack>
  )
}

// BrandProvider loads the partner's look before anything renders (ARCHITECTURE.md §4 step 3).
export default function RootLayout() {
  return (
    <BrandProvider>
      <StatusBar style="auto" />
      <SessionProvider>
        <Routes />
      </SessionProvider>
    </BrandProvider>
  )
}
