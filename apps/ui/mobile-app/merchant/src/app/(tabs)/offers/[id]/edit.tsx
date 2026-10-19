import { useLocalSearchParams } from 'expo-router'
import { OfferEditorScreen } from '../../../../features/offers/editor/OfferEditorScreen'

export default function EditOfferRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <OfferEditorScreen key={id} id={id} />
}
