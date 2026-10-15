import { useLocalSearchParams } from 'expo-router'
import { orderFilters, type OrderFilter } from '../../../api/orders'
import { OrdersScreen } from '../../../features/orders/OrdersScreen'

// `?filter=TO_SHIP` opens the list on a chip, as Home's "Needs you" does.
export default function Orders() {
  const { filter } = useLocalSearchParams<{ filter?: string }>()
  const initial: OrderFilter = orderFilters.find((known) => known === filter) ?? 'ALL'
  return <OrdersScreen key={initial} initialFilter={initial} />
}
