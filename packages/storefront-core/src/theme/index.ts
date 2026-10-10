// What a theme may import (storefront ARCHITECTURE §3.4 "Imports"): core's hooks and components, never its internals.
export { type Translate } from '../platform/i18n/i18n'
export { ConsentBanner, ConsentSettingsButton, LegalNotices, PoweredBy, PreviewBanner, Price, type LegalNotice, type PriceProps } from '../platform/required'
export { useStorefront, type RenderMode, type Storefront } from '../platform/store/context'
