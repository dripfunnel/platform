import { createFileRoute } from '@tanstack/react-router'
import { loadTemplates } from '../../api/templates'
import { TemplatesLoading } from '../../features/templates/Templates'
import { TemplatesRouteError, TemplatesScreen } from '../../features/templates/TemplatesScreen'

export const Route = createFileRoute('/_app/templates')({
  loader: () => loadTemplates(),
  pendingComponent: TemplatesLoading,
  errorComponent: TemplatesRouteError,
  component: TemplatesScreen,
})
