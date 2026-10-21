import { useLocalSearchParams } from 'expo-router'
import { SupplierOrderScreen } from '../../../features/supplier/SupplierOrderScreen'

export default function SupplierOrderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <SupplierOrderScreen key={id} id={id} />
}
