import { useLocalSearchParams } from 'expo-router'
import { OrderScreen } from '../../../features/orders/OrderScreen'

export default function OrderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <OrderScreen key={id} id={id} />
}
