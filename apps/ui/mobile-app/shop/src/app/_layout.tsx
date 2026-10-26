// First, so the Intl polyfills are in place before anything formats (merchant/REACT-NATIVE.md §6).
import '@dripfunnel/mobile-shared/intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ShopProvider } from '../api/ShopProvider'
import { BrandProvider } from '../brand/BrandProvider'

// BrandProvider loads the store's look before anything renders; ShopProvider holds the one client the screens call the Shop API with.
export default function RootLayout() {
  return (
    <BrandProvider>
      <ShopProvider>
        <GestureHandlerRootView style={styles.root}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </GestureHandlerRootView>
      </ShopProvider>
    </BrandProvider>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
