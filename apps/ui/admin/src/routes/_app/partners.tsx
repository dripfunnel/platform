import { createFileRoute } from '@tanstack/react-router'
import { Partners } from '../../features/partners/Partners'

export const Route = createFileRoute('/_app/partners')({ component: Partners })
