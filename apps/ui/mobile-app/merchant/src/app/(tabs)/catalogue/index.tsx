import { useState } from 'react'
import { View } from 'react-native'
import { CollectionsArea } from '../../../features/collections/CollectionsArea'
import { ProductsScreen } from '../../../features/products/ProductsScreen'
import { SegmentedControl } from '../../../features/shell/SegmentedControl'
import { t } from '../../../messages'

type Segment = 'products' | 'collections'

// Products | Collections under one tab (DESIGN.md §2); Collections holds its own filters, menus and size charts (FIRST-RELEASE.md §12).
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
      {segment === 'products' ? <ProductsScreen /> : <CollectionsArea />}
    </View>
  )
}
