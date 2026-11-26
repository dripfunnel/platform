import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { categoryOptions, loadStoreCategories } from '../../api/storeCategories'
import { loadTemplates } from '../../api/templates'
import { idParam } from '@dripfunnel/shared/search'
import { TemplatesLoading } from '../../features/templates/Templates'
import { TemplatesRouteError, TemplatesScreen } from '../../features/templates/TemplatesScreen'

// Store categories links here with its row's `category` (FIRST-RELEASE §11d); filtering needs no reload.
export const Route = createFileRoute('/_app/templates')({
  validateSearch: z.object({ category: idParam }),
  loader: async () => {
    const [templates, categories] = await Promise.all([loadTemplates(), loadStoreCategories()])
    return { templates, categories: categoryOptions(categories) }
  },
  pendingComponent: TemplatesLoading,
  errorComponent: TemplatesRouteError,
  component: TemplatesScreen,
})
