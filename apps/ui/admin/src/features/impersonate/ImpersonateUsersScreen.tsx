import { getRouteApi, Link, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import type { TargetFilter } from '../../api/impersonation'
import { useScreenState } from '@dripfunnel/shared/ui'
import type { PageRequest } from '@dripfunnel/shared/graphql'
import { harnessEnabled } from '../../harness'
import { usersStates } from './impersonateHarness'
import { ImpersonateUsers } from './ImpersonateUsers'
import { sessionCallerFor } from './sessionCaller'
import { useStartSession } from './useStartSession'
import { useTargetPage } from './useTargetPage'

const usersRoute = getRouteApi('/_app/impersonate')
const shellRoute = getRouteApi('/_app')

export const ImpersonateUsersScreen = () => {
  const { after, before, ...filter } = usersRoute.useSearch()
  const { me, badges } = shellRoute.useLoaderData()
  const forced = useScreenState(usersStates, harnessEnabled)
  const navigate = usersRoute.useNavigate()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const caller = sessionCallerFor(me.role, searchStr)
  const [search, setSearch] = useState<string | undefined>(undefined)
  const [searchPage, setSearchPage] = useState<PageRequest>({})
  const { result, reload } = useTargetPage(filter, search ? searchPage : { after, before }, search ?? null, caller)
  const { start, returnTo, element } = useStartSession(caller, me.name)

  const changeFilter = (next: TargetFilter) => {
    setSearchPage({})
    void navigate({ search: next, replace: true })
  }
  const changeSearch = (next: string | undefined) => {
    setSearchPage({})
    setSearch(next)
  }

  return (
    <>
      <ImpersonateUsers
        result={result}
        filter={filter}
        search={search}
        forced={forced}
        role={caller}
        openCount={badges.openSessions}
        onFilterChange={changeFilter}
        onSearch={changeSearch}
        onClear={() => {
          changeSearch(undefined)
          changeFilter({})
        }}
        onRetry={reload}
        onImpersonate={(target) => start({ kind: 'impersonation', target, membershipId: null })}
        onReturn={returnTo}
        pageLink={(cursor, label) =>
          search ? (
            <button type="button" className="df-button" onClick={() => setSearchPage(cursor)}>
              {label}
            </button>
          ) : (
            <Link to="/impersonate" search={{ ...filter, ...cursor }} className="df-button">
              {label}
            </Link>
          )
        }
      />
      {element}
    </>
  )
}
