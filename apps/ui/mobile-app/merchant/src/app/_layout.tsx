// First, so the Intl polyfills are in place before anything formats (ARCHITECTURE.md §4 step 1).
import '../intl'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { BrandProvider } from '../brand/BrandProvider'

// BrandProvider loads the partner's look before anything renders (ARCHITECTURE.md §4 step 3).
export default function RootLayout() {
  return (
    <BrandProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </BrandProvider>
  )
}
