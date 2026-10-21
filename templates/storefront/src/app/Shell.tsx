'use client'

import { createI18n, createShopClient, loadStore, storedShopState, StorefrontProvider, type Catalogue, type ShopStoreSettings } from '@dripfunnel/storefront-core'
import { useEffect, useState, type ReactNode } from 'react'
import { storeConfig } from '../../store.config'

const client = createShopClient({ endpoint: storeConfig.shopApi, state: storedShopState })

export const Shell = ({ content, children }: { content: Record<string, Record<string, string>>; children: ReactNode }) => {
  const [store, setStore] = useState<ShopStoreSettings | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    loadStore(client).then(setStore, () => setFailed(true))
  }, [])
  if (failed) return <p role="alert">{createI18n('en').t('store.failed')}</p>
  if (!store) return null
  const { t } = createI18n(store.language, content as Record<string, Catalogue>)
  return <StorefrontProvider value={{ client, store, locale: store.language, t, mode: 'live', poweredBy: null }}>{children}</StorefrontProvider>
}
