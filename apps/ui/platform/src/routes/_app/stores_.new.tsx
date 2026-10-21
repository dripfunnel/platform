import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadCreateStoreForm } from '../../api/stores'
import { CreateStorePending, CreateStoreRouteError, CreateStoreScreen } from '../../features/stores/CreateStoreScreen'

// The form's options and whether this caller may create a store are the API's (FIRST-RELEASE.md §6.2).
export const Route = createFileRoute('/_app/stores_/new')({
  validateSearch: z.looseObject({ state: z.string().optional(), partner: z.string().optional() }),
  loader: () => loadCreateStoreForm(),
  pendingComponent: CreateStorePending,
  errorComponent: CreateStoreRouteError,
  component: CreateStoreScreen,
})
