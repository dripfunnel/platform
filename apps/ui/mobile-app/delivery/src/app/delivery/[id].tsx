import { useLocalSearchParams } from 'expo-router'
import { DeliveryScreen } from '../../features/delivery/DeliveryScreen'

export default function Delivery() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <DeliveryScreen id={id} />
}
