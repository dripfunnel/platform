import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createStaffServer } from '../../api/staffSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { Staff, type StaffProps } from './Staff'
import { staffDialog } from './staffDialog'

const words = messages.staff
const now = Date.parse('2026-10-01T09:00:00Z')
const pageOf = (size = 50) => createStaffServer({ now: () => now }).list({}, size, 'staff-super-admin')
const noop = () => undefined

const render = async (props: Partial<StaffProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <Staff page={pageOf()} forced={null} me={{ id: 'st-arjun', role: 'staff-super-admin' }} refusal={null} onInvite={noop} onAction={noop} onReload={noop} {...props} />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/staff'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const rowOf = (html: string, name: string) => {
  const start = html.indexOf(name)
  return html.slice(html.lastIndexOf('<tr', start), html.indexOf('</tr>', start))
}

describe('Staff', () => {
  it('lists name, email, role, last sign-in and 2-factor, with Invite', async () => {
    const html = await render()
    const text = textOf(html)
    for (const column of Object.values(words.columns)) expect(text).toContain(column)
    expect(text).toContain('neha@dripfunnel.com')
    expect(textOf(rowOf(html, 'Sam Lee'))).toContain(words.twoFactor.off)
    expect(textOf(rowOf(html, 'Neha Rao'))).toContain('Support')
    expect(html).toMatch(/<button[^>]*>Invite staff<\/button>/)
  })

  it('disables the last Super admin’s controls with the reason, and says there is only one', async () => {
    const html = await render()
    const row = rowOf(html, 'Arjun Menon')
    expect(textOf(row)).toContain(words.you)
    const reasonId = /<p id="([^"]+)" class="df-staff-reason">/.exec(row)?.[1]
    expect(textOf(row)).toContain('Arjun Menon is the only Super admin. Make someone else a Super admin first.')
    expect(row.match(new RegExp(`disabled="" aria-describedby="${reasonId}"`, 'g'))).toHaveLength(2)
    expect(textOf(html)).toContain(words.soleSuperAdmin)
    expect(rowOf(html, 'Neha Rao')).not.toContain('disabled')
  })

  it('shows a refusal from the server as its own message, not a generic failure', async () => {
    const html = await render({ refusal: 'Arjun Menon is the only Super admin. Make someone else a Super admin first.' })
    expect(html).toMatch(/role="alert">Arjun Menon is the only Super admin/)
    expect(textOf(html)).not.toContain(words.toasts.failed)
  })

  it('shows a pending invitation with its expiry, and an expired one, with Resend and Revoke', async () => {
    const html = await render()
    const pending = textOf(rowOf(html, 'kiran@dripfunnel.com'))
    expect(pending).toContain('Invited Sep 29, 2026 · link expires Oct 6, 2026')
    expect(pending).toContain(words.twoFactor.notSignedIn)
    expect(pending).toContain(words.actions.resend)
    expect(pending).toContain(words.actions.revoke)
    expect(pending).not.toContain(words.actions.remove)
    expect(textOf(rowOf(html, 'noor@dripfunnel.com'))).toContain('Invitation expired')
  })

  it('offers only the prototype’s row actions, with no Activity link', async () => {
    const html = await render()
    expect(html).not.toContain('href="/activity')
    expect(textOf(rowOf(html, 'Neha Rao'))).toContain(`${words.actions.changeRole}${words.actions.remove}`)
  })

  it('never puts an invitation link or token in the page', async () => {
    expect(await render()).not.toMatch(/token|accept-invite/i)
  })

  it('pages with Previous and Next, and no total', async () => {
    const html = await render({ page: pageOf(3) })
    expect(html).toMatch(/href="\/staff\?after=[^"]+"/)
    expect(textOf(html)).not.toMatch(/\bof \d+|\d+ staff/i)
  })

  it('denies someone who reaches the URL without the role, and says who can', async () => {
    const text = textOf(await render({ page: null, me: { id: 'st-neha', role: 'staff-support' } }))
    expect(text).toContain(words.denied.title)
    expect(text).toContain('You’re signed in as Support.')
    expect(text).not.toContain(words.invite)
  })

  it('renders the loading, error and empty states', async () => {
    expect(await render({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await render({ forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await render({ forced: 'empty' }))).toContain(words.empty.title)
  })
})

describe('staffDialog', () => {
  const member = (id: string) => {
    const found = pageOf()?.items.find((one) => one.id === id)
    if (!found) throw new Error(`No sample staff ${id}`)
    return found
  }
  const consequenceOf = (dialog: ReturnType<typeof staffDialog>, value = '', choice = '') =>
    typeof dialog?.consequence === 'function' ? dialog.consequence(value, choice) : dialog?.consequence

  it('invites by any email, naming it and the role', () => {
    const dialog = staffDialog('invite', null, 'st-arjun')
    expect(consequenceOf(dialog, 'ana@example.org', 'staff-finance')).toBe(
      'Sends ana@example.org a link to join the admin console as Finance. The link works once, for 7 days, and they sign in with company SSO.',
    )
    expect(dialog?.input?.error('ana@example.org')).toBeNull()
    expect(dialog?.input?.error('ana')).toBe(words.dialogs.invite.emailError)
    expect(dialog?.choice?.initial).toBe('staff-support')
  })

  it('changes a role naming the person, and refuses the same role', () => {
    const dialog = staffDialog('changeRole', member('st-neha'), 'st-arjun')
    expect(dialog?.title).toBe('Change Neha Rao’s role')
    expect(consequenceOf(dialog, '', 'staff-finance')).toBe('Neha Rao becomes Finance, with that role’s access from their next request.')
    expect(dialog?.choice?.error('staff-support')).toBe(words.dialogs.changeRole.sameRole)
    expect(consequenceOf(staffDialog('changeRole', member('st-arjun'), 'st-arjun'), '', 'staff-support')).toContain('You become Support')
  })

  it('removes as a destructive action naming the person, and warns when it is you', () => {
    const dialog = staffDialog('remove', member('st-neha'), 'st-arjun')
    expect(dialog).toMatchObject({ title: 'Remove Neha Rao?', target: 'Neha Rao', danger: true })
    expect(staffDialog('remove', member('st-arjun'), 'st-arjun')?.notes).toEqual([words.dialogs.remove.self])
  })

  it('says resending stops the old link working', () => {
    expect(consequenceOf(staffDialog('resend', member('st-kiran'), 'st-arjun'))).toBe(
      'A new link goes to kiran@dripfunnel.com and works for 7 days. The old link stops working.',
    )
    expect(staffDialog('revoke', member('st-kiran'), 'st-arjun')?.danger).toBe(true)
  })
})
