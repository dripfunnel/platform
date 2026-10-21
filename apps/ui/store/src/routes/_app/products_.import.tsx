import { createFileRoute } from '@tanstack/react-router'
import { ImportPage } from '../../features/imports/ImportPage'
import { importSearch } from '../../features/imports/importSearch'

export const Route = createFileRoute('/_app/products_/import')({ validateSearch: importSearch, component: ImportPage })
