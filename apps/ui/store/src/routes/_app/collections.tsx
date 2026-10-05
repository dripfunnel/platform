import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CollectionsPage } from '../../features/collections/CollectionsPage'

// `tab` picks Filters or Menus; `edit` opens a collection (or `new`); `name` starts one from a seasonal idea.
export const Route = createFileRoute('/_app/collections')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(['filters', 'menus'])), edit: idParam, name: searchParam }),
  component: CollectionsPage,
})
