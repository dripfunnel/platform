import { useLocalSearchParams } from 'expo-router'
import { MarketEditorScreen } from '../../../../../features/settings/markets/MarketEditorScreen'

// `new` opens an empty market named by `?name=`; any other id is the market's own.
export default function MarketRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  return <MarketEditorScreen key={id} id={id === 'new' ? null : id} suggested={id === 'new' && name ? name : ''} />
}
