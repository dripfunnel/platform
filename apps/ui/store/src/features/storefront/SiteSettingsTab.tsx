import type { StorefrontBrand } from '../../api/storefront'
import { BrandCard } from './BrandCard'
import type { StorefrontApi } from './storefrontApi'

export interface SiteSettingsTabProps {
  brand: StorefrontBrand | null
  canEdit: boolean
  api: StorefrontApi
  onBrand: (brand: StorefrontBrand, toast: string) => void
}

/** Site settings (PortalStorefront, FIRST-RELEASE §14): its cards, each saving on its own. */
export const SiteSettingsTab = ({ brand, canEdit, api, onBrand }: SiteSettingsTabProps) => (
  <div className="df-sf-settings">
    <BrandCard brand={brand} canEdit={canEdit} api={api} onSaved={onBrand} />
  </div>
)
