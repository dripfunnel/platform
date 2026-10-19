import { Stack } from 'expo-router'

// One tab with a stack inside, so an offer opened from the list keeps Offers active and the header shows Back.
export default function OffersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
