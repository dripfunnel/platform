import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { productFilters, type ProductFilter } from '../../../api/products'
import { CollectionsArea } from '../../../features/collections/CollectionsArea'
import { ProductsScreen } from '../../../features/products/ProductsScreen'
import { SegmentedControl } from '../../../features/shell/SegmentedControl'
import { t } from '../../../messages'

type Segment = 'products' | 'collections'

// Products | Collections under one tab (DESIGN.md §2); Collections holds its own filters, menus and size charts (FIRST-RELEASE.md §12).
// `?filter=low_stock` opens Products on a chip, as Home's "Needs you" does; `visit` is new on each press, so it applies again on a tab that stayed mounted.
export default function Catalogue() {
  const [segment, setSegment] = useState<Segment>('products')
  const { filter, visit } = useLocalSearchParams<{ filter?: string; visit?: string }>()
  const initial: ProductFilter = productFilters.find((known) => known === filter) ?? 'all'
  useEffect(() => {
    if (filter) setSegment('products')
  }, [filter, visit])
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
      {segment === 'products' ? <ProductsScreen key={`${initial}:${visit ?? ''}`} initialFilter={initial} /> : <CollectionsArea />}
    </View>
  )
}
