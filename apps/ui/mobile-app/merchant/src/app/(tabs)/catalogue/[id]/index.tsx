import { useLocalSearchParams } from 'expo-router'
import { ProductEditorScreen } from '../../../../features/products/editor/ProductEditorScreen'

// `new` opens an empty product; any other id is the product's own. A new product's first save moves to its own id, so the screen restarts per id.
export default function ProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ProductEditorScreen key={id} id={id === 'new' ? null : id} />
}
