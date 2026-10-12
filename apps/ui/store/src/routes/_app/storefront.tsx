import { createFileRoute } from '@tanstack/react-router'
import { StorefrontPage } from '../../features/storefront/StorefrontPage'
import { storefrontSearch } from '../../features/storefront/storefrontSearch'

export const Route = createFileRoute('/_app/storefront')({ validateSearch: storefrontSearch, component: StorefrontPage })
