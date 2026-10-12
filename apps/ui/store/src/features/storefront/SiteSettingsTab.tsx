import type { StorefrontBrand, StorefrontDomains, StorefrontSeo } from '../../api/storefront'
import { BrandCard } from './BrandCard'
import { DomainsCard } from './DomainsCard'
import { SeoCard } from './SeoCard'
import type { StorefrontApi } from './storefrontApi'

export interface SiteSettingsTabProps {
  brand: StorefrontBrand | null
  seo: StorefrontSeo
  domains: StorefrontDomains
  canEdit: boolean
  canUpgrade: boolean
  api: StorefrontApi
  onBrand: (brand: StorefrontBrand, toast: string) => void
  onSeo: (seo: StorefrontSeo, toast: string) => void
  onDomains: (domains: StorefrontDomains) => void
  onToast: (text: string) => void
}

/** Site settings (PortalStorefront): Brand above Domains, then Search and sharing; each card saves on its own. */
export const SiteSettingsTab = ({ brand, seo, domains, canEdit, canUpgrade, api, onBrand, onSeo, onDomains, onToast }: SiteSettingsTabProps) => {
  const primary = domains.domains.find((d) => d.primary) ?? domains.domains[0]
  return (
    <div className="df-sf-settings">
      <BrandCard brand={brand} canEdit={canEdit} api={api} onSaved={onBrand} />
      <DomainsCard domains={domains} onDomains={onDomains} canEdit={canEdit} canUpgrade={canUpgrade} api={api} onToast={onToast} />
      <SeoCard seo={seo} shopName={brand?.shopName ?? ''} host={primary?.host ?? ''} canEdit={canEdit} api={api} onSaved={onSeo} />
    </div>
  )
}
