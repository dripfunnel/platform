import { useLocalSearchParams } from 'expo-router'
import { StoryScreen } from '../../../../features/products/story/StoryScreen'

export default function StoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <StoryScreen key={id} id={id} />
}
