import { createContext, useContext } from 'react'
import * as imports from '../../api/imports'
import { loadProductCounts } from '../../api/products'
import { loadPlaces } from '../../api/stock'

// What Import & export reads and writes, given by context so the ?state= harness can answer with samples (importStates.ts).
export const liveImportApi = {
  loadImport: imports.loadImport,
  startFileImport: imports.startFileImport,
  confirmImport: imports.confirmImport,
  loadImportTemplate: imports.loadImportTemplate,
  loadShopifyConnection: imports.loadShopifyConnection,
  loadShopifyProducts: imports.loadShopifyProducts,
  connectShopify: imports.connectShopify,
  finishShopifyConnect: imports.finishShopifyConnect,
  startShopifyImport: imports.startShopifyImport,
  loadCatalogExports: imports.loadCatalogExports,
  requestProductExport: imports.requestProductExport,
  loadPlaces,
  loadProductCounts,
}

export type ImportApi = typeof liveImportApi

export const ImportApiContext = createContext<ImportApi>(liveImportApi)

export const useImportApi = () => useContext(ImportApiContext)
