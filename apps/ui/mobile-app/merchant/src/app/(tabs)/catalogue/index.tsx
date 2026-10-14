import { useState } from 'react'
import { View } from 'react-native'
import { PlaceholderScreen } from '../../../features/placeholder/PlaceholderScreen'
import { SegmentedControl } from '../../../features/shell/SegmentedControl'
import { t } from '../../../messages'

type Segment = 'products' | 'collections'

// Products | Collections under one tab (DESIGN.md §2); each is built by its own card.
export default function Catalogue() {
  const [segment, setSegment] = useState<Segment>('products')
  return (
    <View style={{ flex: 1 }}>
      <SegmentedControl
        segments={[
          { key: 'products', label: t('catalogue.products') },
          { key: 'collections', label: t('catalogue.collections') },
        ]}
        value={segment}
        onChange={setSegment}
      />
      <PlaceholderScreen title={t(segment === 'products' ? 'catalogue.products' : 'catalogue.collections')} />
    </View>
  )
}
