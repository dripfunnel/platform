// The portal opens in a new tab (FIRST-RELEASE.md §8). The tab is opened on the click itself,
// before the sign-in and the API answer, because a browser blocks a tab opened later.
export interface PortalTab {
  go: (url: string) => void
  close: () => void
  blocked: boolean
}

export const reservePortalTab = (): PortalTab => {
  const tab = window.open('about:blank', '_blank')
  if (tab) tab.opener = null
  return {
    go: (url) => {
      if (tab) tab.location.replace(url)
    },
    close: () => tab?.close(),
    blocked: tab === null,
  }
}
