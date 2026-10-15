'use client'

import { createI18n, createShopClient, loadStore, StorefrontProvider, type Catalogue, type ShopStoreSettings } from '@dripfunnel/storefront-core'
import { useEffect, useState, type ReactNode } from 'react'
import { storeConfig } from '../../store.config'

const client = createShopClient({ endpoint: storeConfig.shopApi })

export const Shell = ({ content, children }: { content: Record<string, Record<string, string>>; children: ReactNode }) => {
  const [store, setStore] = useState<ShopStoreSettings | null>(null)
  useEffect(() => {
    void loadStore(client).then(setStore)
  }, [])
  if (!store) return null
  const { t } = createI18n(store.language, content as Record<string, Catalogue>)
  return <StorefrontProvider value={{ client, store, locale: store.language, t, mode: 'live', poweredBy: null }}>{children}</StorefrontProvider>
}
