import { Stack } from 'expo-router'

// One tab with a stack inside, so a product opened from the list keeps Catalogue active and the header shows Back.
export default function CatalogueLayout() {
  return <Stack screenOptions={{ headerShown: false }} />
}
