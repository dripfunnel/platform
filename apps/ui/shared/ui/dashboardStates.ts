// The states a console Dashboard designs (ui/README §6); the harness forces them with ?state=.
export const dashboardStates = ['loading', 'empty', 'error', 'stale', 'offline'] as const

export type DashboardState = (typeof dashboardStates)[number]

export interface DashboardNoticeWords {
  offline: { title: string; body: string }
  stale: { title: string; body: string }
}

// The notice over the cards: offline when forced, stale when forced or when the API marks the
// numbers old. `fill` and `formatTime` are the app's, so the words and the zone stay its own.
export const dashboardNotice = (
  data: { staleSince: string | null; asOf: string },
  forced: DashboardState | null,
  words: DashboardNoticeWords,
  fill: (template: string, values: Record<string, string>) => string,
  formatTime: (iso: string) => string,
): { title: string; body: string } | null => {
  if (forced === 'offline') return words.offline
  if (forced === 'stale' || data.staleSince !== null) {
    return { title: fill(words.stale.title, { time: formatTime(data.staleSince ?? data.asOf) }), body: words.stale.body }
  }
  return null
}
