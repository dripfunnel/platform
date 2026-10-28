// First, so the Intl polyfills are in place before anything formats (merchant/REACT-NATIVE.md §6).
import '@dripfunnel/mobile-shared/intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { BrandProvider } from '../brand/BrandProvider'
import { SessionProvider } from '../session/SessionProvider'
import { useSession } from '../session/SessionContext'

// BrandProvider loads the store's look before anything renders; SessionProvider holds the token and the one client. A call the API answers
// as signed out drops the token, which takes every signed-in screen away and leaves getting in. Push and location join with DL 13–DL 14.
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
        <GestureHandlerRootView style={styles.root}>
          <StatusBar style="auto" />
          <Screens />
        </GestureHandlerRootView>
      </SessionProvider>
    </BrandProvider>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
