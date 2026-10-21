import { useLocalSearchParams } from 'expo-router'
import { OfferEditorScreen } from '../../../features/offers/editor/OfferEditorScreen'

// A new offer; `?type=` skips the kind picker, as the first-time panel does.
export default function NewOfferRoute() {
  const { type } = useLocalSearchParams<{ type?: string }>()
  return <OfferEditorScreen id={null} {...(type ? { type } : {})} />
}
