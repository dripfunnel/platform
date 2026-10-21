import type { BrandingFields } from '#db/scoped/branding'

// The prototype's two partners' look and words (designs/partner-data.js PARTNERS), with every
// address under the seed's `.example` domains: Northstar's published, Kaufladen's a draft with
// no Impressum and "Powered by" on, as its contract fixes it.
export const brandings: Record<string, { state: 'draft' | 'published'; by: string; fields: BrandingFields }> = {
  ns: {
    state: 'published',
    by: 'Maya Chen',
    fields: {
      product_name: 'Northstar Shops', primary_color: '#0F5E63', accent_color: '#E8C9A0', font: 'Nunito', corner: 'rounded', background: 'sand',
      logo_light_key: 'partners/ns/northstar-shops-logo.svg', logo_dark_key: 'partners/ns/northstar-shops-logo-white.svg',
      mark_key: 'partners/ns/northstar-mark.svg', favicon_key: 'partners/ns/favicon-64.png',
      app_icon_key: null, app_icon_foreground_key: null, splash_key: null,
      support_email: 'help@northstar.example', support_url: 'https://help.northstar.example', help_url: 'https://help.northstar.example/shops',
      terms_url: 'https://northstar.example/shops/terms', privacy_url: 'https://northstar.example/shops/privacy', dpa_url: 'https://northstar.example/shops/dpa',
      impressum: null, powered_by: false,
    },
  },
  kl: {
    state: 'draft',
    by: 'Jonas Weber',
    fields: {
      product_name: 'Kaufladen Shops', primary_color: '#1F3A5F', accent_color: '#F2B134', font: 'Source Sans 3', corner: 'soft', background: 'plain',
      logo_light_key: 'partners/kl/kaufladen-shops-logo.svg', logo_dark_key: 'partners/kl/kaufladen-shops-logo-white.svg',
      mark_key: 'partners/kl/kaufladen-mark.svg', favicon_key: 'partners/kl/favicon-64.png',
      app_icon_key: null, app_icon_foreground_key: null, splash_key: null,
      support_email: 'hilfe@kaufladen.example', support_url: null, help_url: null,
      terms_url: 'https://kaufladen.example/agb', privacy_url: 'https://kaufladen.example/datenschutz', dpa_url: null,
      impressum: null, powered_by: true,
    },
  },
}
