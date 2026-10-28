import { useLocalSearchParams } from 'expo-router'
import { OrderScreen } from '../../../features/orders/OrderScreen'

export default function Order() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <OrderScreen key={id} orderId={id} />
}
