import { useLocalSearchParams } from 'expo-router'
import { CartScreen } from '../../../../features/carts/CartScreen'

export default function CartRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <CartScreen key={id} id={id} />
}
