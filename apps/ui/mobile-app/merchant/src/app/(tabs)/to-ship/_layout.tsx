import { Stack } from 'expo-router'

// One tab with a stack inside, so an order opened from the list keeps To ship active and the header shows Back.
export default function ToShipLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
