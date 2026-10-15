import { useLocalSearchParams } from 'expo-router'
import { CollectionEditorScreen } from '../../../../features/collections/CollectionEditorScreen'

// `new` opens an empty collection (`?name=` carries a seasonal idea); any other id is the collection's own.
export default function CollectionRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  return <CollectionEditorScreen key={id} id={id === 'new' ? null : id} suggested={id === 'new' && name ? name : null} />
}
