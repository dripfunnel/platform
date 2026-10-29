// First, so the Intl polyfills are in place before anything formats (merchant/REACT-NATIVE.md §6).
import '@dripfunnel/mobile-shared/intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { BrandProvider } from '../brand/BrandProvider'
import { CrashBoundary } from '../crash/CrashBoundary'
import { CrashEffects } from '../crash/CrashEffects'
import '../location/task'
import { PendingProvider } from '../pending/PendingContext'
import { PushProvider } from '../push/PushContext'
import { SessionProvider } from '../session/SessionProvider'
import { useSession } from '../session/SessionContext'
import { UpdateGate } from '../update/UpdateGate'

// BrandProvider loads the store's look before anything renders; SessionProvider holds the token and the one client. A call the API answers
// as signed out drops the token, which takes every signed-in screen away and leaves getting in. The position task is defined at import; PushProvider handles pushes.
function Screens() {
  const { signedIn } = useSession()
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="setup" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" options={{ gestureEnabled: false }} />
        <Stack.Screen name="profile-edit" />
        <Stack.Screen name="delivery/[id]" />
      </Stack.Protected>
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <BrandProvider>
      <SessionProvider>
        <UpdateGate>
          <PushProvider>
            <PendingProvider>
              <GestureHandlerRootView style={styles.root}>
                <StatusBar style="auto" />
                <CrashEffects />
                <CrashBoundary>
                  <Screens />
                </CrashBoundary>
              </GestureHandlerRootView>
            </PendingProvider>
          </PushProvider>
        </UpdateGate>
      </SessionProvider>
    </BrandProvider>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
