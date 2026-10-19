import { useLocalSearchParams } from 'expo-router'
import { OfferScreen } from '../../../../features/offers/OfferScreen'

export default function OfferRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <OfferScreen key={id} id={id} />
}
