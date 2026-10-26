import { useLocalSearchParams } from 'expo-router'
import { ProductScreen } from '../../features/catalogue/ProductScreen'

export default function Product() {
  const { handle } = useLocalSearchParams<{ handle: string }>()
  return <ProductScreen key={handle} slug={handle} />
}
