import { useLocalSearchParams } from 'expo-router'
import { CustomerScreen } from '../../../../features/customers/CustomerScreen'

export default function CustomerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <CustomerScreen key={id} id={id} />
}
