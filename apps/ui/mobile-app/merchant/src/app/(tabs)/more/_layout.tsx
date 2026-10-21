import { Stack } from 'expo-router'

// One tab with a stack inside, so a screen opened from More keeps More active and the header shows Back.
export default function MoreLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
