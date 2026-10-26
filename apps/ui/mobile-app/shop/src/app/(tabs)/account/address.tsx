import { useLocalSearchParams } from 'expo-router'
import { AddressFormScreen } from '../../../features/addresses/AddressFormScreen'

export default function Address() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  return <AddressFormScreen key={id ?? 'new'} id={id ?? null} />
}
