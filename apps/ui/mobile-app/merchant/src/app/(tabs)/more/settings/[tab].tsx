import { useLocalSearchParams } from 'expo-router'
import { SettingsTabScreen } from '../../../../features/settings/SettingsTabScreen'

export default function SettingsTabRoute() {
  const { tab } = useLocalSearchParams<{ tab: string }>()
  return <SettingsTabScreen key={tab} tab={tab} />
}
