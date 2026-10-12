import type { StorefrontBrand, StorefrontDomains, StorefrontMeters, StorefrontSeo, StorefrontTemplate } from '../../api/storefront'
import { BrandCard } from './BrandCard'
import { DomainsCard } from './DomainsCard'
import { HistoryCard } from './HistoryCard'
import { SeoCard } from './SeoCard'
import type { StorefrontApi } from './storefrontApi'
import { UsageCard } from './UsageCard'

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
  usage: StorefrontMeters['usage']
  templates: readonly StorefrontTemplate[]
  liveNumber: number | null
  onWent: (toast: string) => void
}

/** Site settings (PortalStorefront): Brand, Domains and Search and sharing; beside them AI and build minutes and Version history. */
export const SiteSettingsTab = ({ brand, seo, domains, canEdit, canUpgrade, api, onBrand, onSeo, onDomains, onToast, usage, templates, liveNumber, onWent }: SiteSettingsTabProps) => {
  const primary = domains.domains.find((d) => d.primary) ?? domains.domains[0]
  return (
    <div className="df-sf-settings-columns">
      <div className="df-sf-settings">
        <BrandCard brand={brand} canEdit={canEdit} api={api} onSaved={onBrand} />
        <DomainsCard domains={domains} onDomains={onDomains} canEdit={canEdit} canUpgrade={canUpgrade} api={api} onToast={onToast} />
        <SeoCard seo={seo} shopName={brand?.shopName ?? ''} host={primary?.host ?? ''} canEdit={canEdit} api={api} onSaved={onSeo} />
      </div>
      <div className="df-sf-settings">
        <UsageCard usage={usage} />
        <HistoryCard templates={templates} canEdit={canEdit} api={api} liveNumber={liveNumber} onWent={onWent} />
      </div>
    </div>
  )
}
