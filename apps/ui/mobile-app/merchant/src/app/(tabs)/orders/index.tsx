import { useLocalSearchParams } from 'expo-router'
import { orderFilters, type OrderFilter } from '../../../api/orders'
import { OrdersScreen } from '../../../features/orders/OrdersScreen'

// `?filter=TO_SHIP` opens the list on a chip, as Home's "Needs you" does; `visit` is new on each press, so the chip applies again on a tab that stayed mounted.
export default function Orders() {
  const { filter, visit } = useLocalSearchParams<{ filter?: string; visit?: string }>()
  const initial: OrderFilter = orderFilters.find((known) => known === filter) ?? 'ALL'
  return <OrdersScreen key={`${initial}:${visit ?? ''}`} initialFilter={initial} />
}
