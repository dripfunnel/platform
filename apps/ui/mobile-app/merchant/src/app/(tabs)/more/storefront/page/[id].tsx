import { useLocalSearchParams } from 'expo-router'
import { ContentEditorScreen } from '../../../../../features/storefront/content/ContentEditorScreen'

export default function PageRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ContentEditorScreen kind="page" id={id ?? 'new'} />
}
