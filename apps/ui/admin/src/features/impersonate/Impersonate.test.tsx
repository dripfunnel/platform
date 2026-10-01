import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TargetFilter } from '../../api/impersonation'
import { createImpersonationServer } from '../../api/impersonationSample'
import { messages } from '../../messages'
import { textOf } from '@dripfunnel/shared/testing'
import type { StaffRole } from '../shell/staffRoles'
import { ImpersonateSessions } from './ImpersonateSessions'
import { ImpersonateUsers, type ImpersonateUsersProps } from './ImpersonateUsers'
import { SessionDetail } from './SessionDetail'
import type { TargetPageResult } from './useTargetPage'

const words = messages.impersonate
const now = Date.parse('2026-10-01T09:00:00Z')
const noop = () => undefined
const link = (_cursor: unknown, label: string) => <span>{label}</span>

const renderAt = async (node: ReactNode) => {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/impersonate'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const usersFor = (role: StaffRole, props: Partial<ImpersonateUsersProps> = {}, filter: TargetFilter = {}) => {
  const server = createImpersonationServer({ now: () => now })
  const page = server.targets(filter, {}, null, 25, role)
  const result: TargetPageResult = page ? { kind: 'ready', page } : { kind: 'denied' }
  return renderAt(
    <ImpersonateUsers
      result={result}
      filter={{}}
      search={undefined}
      forced={null}
      role={role}
      openCount={2}
      onFilterChange={noop}
      onSearch={noop}
      onClear={noop}
      onRetry={noop}
      onImpersonate={noop}
      onReturn={noop}
      pageLink={link}
      {...props}
    />,
  )
}

const sessionsFor = (role: StaffRole) => {
  const server = createImpersonationServer({ now: () => now })
  return renderAt(
    <ImpersonateSessions page={server.sessions({}, {}, 25, role)} filter={{}} forced={null} role={role} openCount={2} now={now} onFilterChange={noop} onAction={noop} onRetry={noop} pageLink={link} />,
  )
}

const detailFor = (id: string, role: StaffRole) => {
  const server = createImpersonationServer({ now: () => now })
  return renderAt(<SessionDetail id={id} lookup={server.session(id, role)} forced={null} role={role} now={now} onAction={noop} onRetry={noop} />)
}

describe('Impersonate · Users', () => {
  it('lists the users with the FIRST-RELEASE §8 columns, and the action as the API allows it', async () => {
    const text = textOf(await usersFor('staff-support'))
    for (const column of Object.values(words.users.columns)) expect(text).toContain(column)
    expect(text).toContain(words.neverListed)
    expect(textOf(await usersFor('staff-support', {}, { status: 'invited' }))).toContain('Aisha hasn’t accepted the invitation yet.')
    expect(text).toContain(words.actions.return)
  })

  it('tells a role without Impersonate so, rather than showing an empty list', async () => {
    const text = textOf(await usersFor('staff-finance'))
    expect(text).toContain(words.denied.title)
    expect(text).not.toContain(words.users.columns.action)
  })

  it('designs its empty, loading, error and no-match states', async () => {
    expect(textOf(await usersFor('staff-support', { forced: 'empty' }))).toContain(words.empty.title)
    expect(textOf(await usersFor('staff-support', { forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await usersFor('staff-support', { forced: 'nomatch' }))).toContain(words.noMatch.title)
    expect(await usersFor('staff-support', { forced: 'loading' })).toContain('df-skeleton')
  })
})

describe('Impersonate · Sessions', () => {
  it('shows both kinds, open and past, with Extend only on the caller’s own impersonation', async () => {
    const text = textOf(await sessionsFor('staff-support'))
    expect(text).toContain(words.sessions.kinds.impersonation)
    expect(text).toContain(words.sessions.kinds.setup)
    expect(text).toContain(words.sessions.outcomes.endedByStaff)
    expect(text.split(words.sessions.actions.extend)).toHaveLength(2)
    expect(text).toContain(words.sessions.preview.title)
  })

  it('previews what members see: Support for an impersonation, DripFunnel for a setup session', async () => {
    const text = textOf(await sessionsFor('staff-super-admin'))
    expect(text).toContain('Support (Neha) is signed in as Rohan.')
    expect(text).toContain('DripFunnel is setting up your console: Maya')
  })

  it('denies the list to a Partner manager, who opens setup sessions by their page', async () => {
    expect(textOf(await sessionsFor('staff-partner-manager'))).toContain(words.denied.title)
    expect(textOf(await detailFor('su-4K9', 'staff-partner-manager'))).toContain('Partner asked for help with branding')
    expect(textOf(await detailFor('imp-7Q2', 'staff-partner-manager'))).toContain(words.session.denied.title)
  })

  it('never calls a staff session read-only, and never shows a session token', async () => {
    for (const html of [await sessionsFor('staff-super-admin'), await detailFor('imp-open1', 'staff-support'), await usersFor('staff-support')]) {
      expect(textOf(html).toLowerCase()).not.toContain('read-only session')
      expect(html).not.toContain('token')
      expect(html).not.toContain('fx.')
    }
  })
})
