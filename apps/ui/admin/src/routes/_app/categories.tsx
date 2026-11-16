import { createFileRoute } from '@tanstack/react-router'
import { loadStoreCategories } from '../../api/storeCategories'
import { StoreCategoriesLoading } from '../../features/storeCategories/StoreCategories'
import { StoreCategoriesRouteError, StoreCategoriesScreen } from '../../features/storeCategories/StoreCategoriesScreen'

export const Route = createFileRoute('/_app/categories')({
  loader: () => loadStoreCategories(),
  pendingComponent: StoreCategoriesLoading,
  errorComponent: StoreCategoriesRouteError,
  component: StoreCategoriesScreen,
})
