import { Stack } from 'expo-router'

// One tab with a stack inside, so a product opened from the list keeps Products active and the header shows Back.
export default function ProductsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
