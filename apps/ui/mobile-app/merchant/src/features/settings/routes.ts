// Settings lives under More (DESIGN.md §2): a list of tabs, each on its own screen, and a market's editor on top of Markets.
export const settingsHref = '/more/settings'
export const settingsTabHref = (tab: string): string => `${settingsHref}/${tab}`
