import { useLocalSearchParams } from 'expo-router'
import { CollectionScreen } from '../../../../features/catalogue/CollectionScreen'

export default function Collection() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  return <CollectionScreen key={slug} slug={slug} />
}
