// First, so the Intl polyfills are in place before anything formats (merchant/REACT-NATIVE.md §6).
import '@dripfunnel/mobile-shared/intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { BrandProvider } from '../brand/BrandProvider'

// BrandProvider loads the store's look before anything renders.
export default function RootLayout() {
  return (
    <BrandProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </BrandProvider>
  )
}
