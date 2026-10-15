import { useLocalSearchParams } from 'expo-router'
import { SizeChartEditorScreen } from '../../../../features/collections/SizeChartEditorScreen'

export default function SizeChartRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <SizeChartEditorScreen key={id} id={id} />
}
