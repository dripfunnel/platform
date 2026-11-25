import { createFileRoute } from '@tanstack/react-router'
import { loadTemplates } from '../../api/templates'
import { TemplatesLoading } from '../../features/templates/Templates'
import { TemplateCollectionScreen, TemplatesRouteError } from '../../features/templates/TemplatesScreen'

export const Route = createFileRoute('/_app/templates_/$collection')({
  loader: () => loadTemplates(),
  pendingComponent: TemplatesLoading,
  errorComponent: TemplatesRouteError,
  component: TemplateCollectionScreen,
})
