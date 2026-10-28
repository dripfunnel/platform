// First, so the Intl polyfills are in place before anything formats (merchant/REACT-NATIVE.md §6).
import '@dripfunnel/mobile-shared/intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ShopProvider } from '../api/ShopProvider'
import { BrandProvider } from '../brand/BrandProvider'
import { MarketsProvider } from '../features/markets/MarketsProvider'
import { OfflineStrip } from '../features/states/OfflineStrip'
import { PushEffects } from '../push/PushEffects'

// BrandProvider loads the store's look before anything renders; MarketsProvider the shopper's language and currency;
// ShopProvider holds the one client the screens call the Shop API with.
export default function RootLayout() {
  return (
    <BrandProvider>
      <MarketsProvider>
        <ShopProvider>
          <GestureHandlerRootView style={styles.root}>
            <StatusBar style="auto" />
            <PushEffects />
            <OfflineStrip>
              <Stack screenOptions={{ headerShown: false }} />
            </OfflineStrip>
          </GestureHandlerRootView>
        </ShopProvider>
      </MarketsProvider>
    </BrandProvider>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
