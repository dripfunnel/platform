import { createFileRoute } from '@tanstack/react-router'
import { TemplatesPage } from '../../features/templates/TemplatesPage'

export const Route = createFileRoute('/_app/templates')({ component: TemplatesPage })
