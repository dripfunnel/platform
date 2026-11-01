import { createFileRoute } from '@tanstack/react-router'
import { NewStore } from '../features/choose-store/NewStore'

export const Route = createFileRoute('/stores_/new')({ component: NewStore })
