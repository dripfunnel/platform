// A tab opened on the click itself, before the API answers, because a browser blocks one opened
// later; `go` then sends it to the link the answer carries (FIRST-RELEASE admin §8, platform §12.2).
export interface ReservedTab {
  tab: Window | null
  go: (url: string) => void
  close: () => void
  blocked: boolean
}

export const reserveTab = (): ReservedTab => {
  const tab = window.open('about:blank', '_blank')
  if (tab) tab.opener = null
  return {
    tab,
    go: (url) => {
      if (tab) tab.location.replace(url)
    },
    close: () => tab?.close(),
    blocked: tab === null,
  }
}
