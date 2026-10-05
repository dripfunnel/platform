import { idParam, searchParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CollectionsPage } from '../../features/collections/CollectionsPage'

// `edit` opens a collection (or `new`); `name` starts a new one from a seasonal idea.
export const Route = createFileRoute('/_app/collections')({
  validateSearch: z.looseObject({ edit: idParam, name: searchParam }),
  component: CollectionsPage,
})
