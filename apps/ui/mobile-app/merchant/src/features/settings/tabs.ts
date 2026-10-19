// The Settings tabs this release has, in PortalSettings' order (FIRST-RELEASE (store) §15). Apps, Support access and the Activity log are #800, #801 and #802;
// Close my store is MA 18 (#511).
export const settingsTabs = ['store', 'people', 'suppliers', 'payments', 'shipping', 'warehouse', 'tax', 'markets', 'catalogue', 'accounts', 'developers'] as const
export type SettingsTab = (typeof settingsTabs)[number]

export const isSettingsTab = (value: string): value is SettingsTab => (settingsTabs as readonly string[]).includes(value)
