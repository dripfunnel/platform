// The Settings tabs this release has, in PortalSettings' order (FIRST-RELEASE (store) §15). Close my store is MA 18 (#511). Riders is listed only on a plan with own delivery (#847).
export const settingsTabs = ['store', 'people', 'suppliers', 'payments', 'shipping', 'warehouse', 'riders', 'tax', 'markets', 'catalogue', 'accounts', 'developers', 'apps', 'support', 'activity'] as const
export type SettingsTab = (typeof settingsTabs)[number]

export const isSettingsTab = (value: string): value is SettingsTab => (settingsTabs as readonly string[]).includes(value)
