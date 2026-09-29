import { createFileRoute } from '@tanstack/react-router'
import { Stores } from '../../features/stores/Stores'

export const Route = createFileRoute('/_app/stores')({ component: Stores })
