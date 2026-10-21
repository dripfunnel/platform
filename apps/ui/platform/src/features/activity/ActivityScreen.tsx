import { startExport, useExportJob, useScreenState, type PersonOption } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { findActivityPeople, loadActivity, loadPersonTimeline, startActivityExport, type ActivityEntry, type ActivityFilter } from '../../api/activity'
import { exportKindOf, startedExport } from '../../api/exports'
import { harnessEnabled } from '../../harness'
import { ActivityError, ActivityLog, personOptionOf } from './ActivityLog'
import { activityStates } from './activityHarness'

const activityRoute = getRouteApi('/_app/activity')
const shellRoute = getRouteApi('/_app')

// Owners and Admins export (ACCESS.md §5.3 activity.export); the API refuses everyone else too.
const exporters: readonly string[] = ['partner-owner', 'partner-admin']

export const ActivityScreen = () => {
  const { page, stores } = activityRoute.useLoaderData()
  const { person, ...filter } = activityRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(activityStates, harnessEnabled)
  const navigate = activityRoute.useNavigate()
  const router = useRouter()
  const chosenName = useRouterState({ select: (state) => state.location.state.personName ?? null })
  // My activity opens on the signed-in user's own reference (§2.2), whose name the shell knows.
  const personName = chosenName ?? (person === `team:${me.id}` ? me.name : null)
  const job = useExportJob()
  const [extra, setExtra] = useState<{ items: readonly ActivityEntry[]; endCursor: string | null; more: boolean } | null>(null)
  const [moreState, setMoreState] = useState<'idle' | 'busy' | 'failed'>('idle')
  // A new filter or person loads the first page again; a Show more still on its way is dropped.
  const loaded = useRef(page)
  useEffect(() => {
    loaded.current = page
    setExtra(null)
    setMoreState('idle')
  }, [page])

  const shown = extra ?? { items: page.items, endCursor: page.pageInfo.endCursor, more: page.pageInfo.hasNextPage }
  const activityFilter: ActivityFilter = filter
  const onMore = () => {
    if (!shown.endCursor) return
    setMoreState('busy')
    const next = person ? loadPersonTimeline(person, activityFilter, { after: shown.endCursor }) : loadActivity(activityFilter, { after: shown.endCursor })
    const asked = page
    next.then(
      (answer) => {
        if (loaded.current !== asked) return
        setExtra({ items: [...shown.items, ...answer.items], endCursor: answer.pageInfo.endCursor, more: answer.pageInfo.hasNextPage })
        setMoreState('idle')
      },
      () => loaded.current === asked && setMoreState('failed'),
    )
  }

  const findPeople = useCallback(async (text: string) => (await findActivityPeople(text)).map(personOptionOf), [])
  // Only the chosen person's reference goes in the URL; the name rides in history state (§13).
  const onChoosePerson = (option: PersonOption) => void navigate({ search: { ...filter, person: option.id }, state: { personName: option.name } })
  const onFilter = (next: ActivityFilter) => void navigate({ search: { ...next, ...(person ? { person } : {}) }, state: personName ? { personName } : {} })
  const onExport = () => void startExport(startedExport('activity', startActivityExport(activityFilter)))

  return (
    <ActivityLog
      entries={shown.items}
      more={shown.more}
      moreState={moreState}
      filter={activityFilter}
      person={person ? { ref: person, name: personName } : null}
      stores={stores}
      forced={forced}
      exportJob={exportKindOf(job) === 'activity' ? job : null}
      canExport={exporters.includes(me.role)}
      findPeople={findPeople}
      onChoosePerson={onChoosePerson}
      onFilter={onFilter}
      onMore={onMore}
      onExport={onExport}
      onRetry={() => void router.invalidate()}
    />
  )
}

export const ActivityRouteError = () => {
  const router = useRouter()
  return <ActivityError onRetry={() => void router.invalidate()} />
}
