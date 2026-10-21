import { useLocalSearchParams } from 'expo-router'
import { ContentEditorScreen } from '../../../../../features/storefront/content/ContentEditorScreen'

export default function PostRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ContentEditorScreen kind="post" id={id ?? 'new'} />
}
