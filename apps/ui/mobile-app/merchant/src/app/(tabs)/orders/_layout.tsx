import { Stack } from 'expo-router'

// One tab with a stack inside, so an order opened from the list keeps Orders active and the header shows Back.
export default function OrdersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
