import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { createShopClient, type ShopClient } from '../src/platform/api/client'
import { StorefrontProvider, type RenderMode } from '../src/platform/store/context'
import { completeStore } from '../src/platform/store/store'

// A Shop API answered in the test: each request goes to `answer`, which may hold it back to answer out of order.

export type Asked = { query: string; variables: Record<string, unknown> }

export const store = completeStore({ name: 'Juniper & Co.', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC' })

export const shopAnswering = (answer: (asked: Asked) => unknown | Promise<unknown>) => {
  const asked: Asked[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables?: Record<string, unknown> }
      const request = { query: body.query, variables: body.variables ?? {} }
      asked.push(request)
      return Response.json(await answer(request))
    }),
  )
  return asked
}

/** A promise the test settles when it chooses. */
export const later = <T,>() => {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

export const Provided = ({ children, mode = 'preview', client = createShopClient(), address }: { children: ReactNode; mode?: RenderMode; client?: ShopClient; address?: string }) => (
  <StorefrontProvider value={{ client, store, locale: 'en-US', mode, poweredBy: null }} {...(address ? { address } : {})}>
    {children}
  </StorefrontProvider>
)
