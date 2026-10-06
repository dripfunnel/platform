import '@dripfunnel/shared/ui/fonts.css'
import '@dripfunnel/shared/ui/tokens.css'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loadBrand, type Brand } from './api/brand'
import { brandSample } from './api/sample'
import { applyBrand } from './brand/applyBrand'
import { setBrand } from './brand/current'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

// The partner's look before anything renders (FIRST-RELEASE.md §2): a host whose brand can't be read
// still opens, in DripFunnel's own colours, so sign-in and the error states stay reachable.
const brandFor = async (): Promise<Brand | null> => {
  const sample = brandSample(new URLSearchParams(window.location.search))
  if (sample) return sample
  try {
    return await loadBrand()
  } catch {
    return null
  }
}

void brandFor().then((brand) => {
  setBrand(brand)
  if (brand) applyBrand(brand)
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
})
