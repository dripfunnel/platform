// First, so the Intl polyfills are in place before anything formats (merchant/REACT-NATIVE.md §6).
import '@dripfunnel/mobile-shared/intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { BrandProvider } from '../brand/BrandProvider'

// BrandProvider loads the store's look before anything renders. The session, push and location providers join it with their cards (DL 12–DL 14).
export default function RootLayout() {
  return (
    <BrandProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </GestureHandlerRootView>
    </BrandProvider>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
