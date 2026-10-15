// The seven Settings tabs this release has, in PortalSettings' order (FIRST-RELEASE (store) §15). Payment setup, Shipping and Customer accounts are
// MA 11 (#504); Developers, Apps and Support access are MA 17 (#510); Close my store is MA 18 (#511).
export const settingsTabs = ['store', 'people', 'suppliers', 'warehouse', 'tax', 'markets', 'catalogue'] as const
export type SettingsTab = (typeof settingsTabs)[number]

export const isSettingsTab = (value: string): value is SettingsTab => (settingsTabs as readonly string[]).includes(value)
