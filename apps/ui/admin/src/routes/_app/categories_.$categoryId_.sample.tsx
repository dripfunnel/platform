import { createFileRoute } from '@tanstack/react-router'
import { loadStoreCategories } from '../../api/storeCategories'
import { loadStoreCategorySample } from '../../api/storeCategorySample'
import { SampleEditorLoading, SampleEditorRouteError, SampleEditorScreen } from '../../features/storeCategories/SampleEditor'

// A category's sample catalog (admin FIRST-RELEASE §11b): the category from the list, its sample from its own query.
export const Route = createFileRoute('/_app/categories_/$categoryId_/sample')({
  loader: async ({ params }) => {
    const [categories, detail] = await Promise.all([loadStoreCategories(), loadStoreCategorySample(params.categoryId)])
    return { category: categories.find((c) => c.id === params.categoryId) ?? null, detail }
  },
  pendingComponent: SampleEditorLoading,
  errorComponent: SampleEditorRouteError,
  component: SampleEditorScreen,
})
