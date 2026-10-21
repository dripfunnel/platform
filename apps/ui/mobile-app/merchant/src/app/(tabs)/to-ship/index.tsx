import { useLocalSearchParams } from 'expo-router'
import { orderFilters, type OrderFilter } from '../../../api/orders'
import { ToShipScreen } from '../../../features/supplier/ToShipScreen'

// `?filter=TO_SHIP` opens the list on a chip, as Orders does.
export default function ToShip() {
  const { filter } = useLocalSearchParams<{ filter?: string }>()
  const initial: OrderFilter = orderFilters.find((known) => known === filter) ?? 'ALL'
  return <ToShipScreen key={initial} initialFilter={initial} />
}
