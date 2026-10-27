import { useLocalSearchParams } from 'expo-router'
import { TrackingScreen } from '../../../features/tracking/TrackingScreen'

export default function Track() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <TrackingScreen key={id} orderId={id} />
}
