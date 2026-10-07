import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@dripfunnel/shared/graphql'
import type { ActionPermission } from '../../api/partners'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { CreatePartner, refusalOf, type CreatePartnerState } from './CreatePartnerScreen'
import { draftErrors, emptyDraft } from './partnerDraft'
import { partnerCurrencies } from './partnerCurrencies'

const words = messages.partners.createForm
const allowed: ActionPermission = { allowed: true }

const render = async (forced: CreatePartnerState | null = null, permission: ActionPermission = allowed) => {
  const rootRoute = createRootRoute({ component: () => <CreatePartner permission={permission} forced={forced} onCreated={() => undefined} /> })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/partners/new'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const labels = (html: string) => [...html.matchAll(/<label for="[^"]+"[^>]*>([^<]*)<\/label>/g)].map((match) => textOf(match[1] ?? ''))

describe('Create partner', () => {
  it('asks for exactly what §4.3 names, the contract among it, with two invitation choices, as a page form and not a dialog', async () => {
    const html = await render()
    expect(labels(html)).toEqual([words.name, words.ownerEmail, words.country, messages.partner.contract.feeCurrency])
    // Three "Powered by" terms and the two invitation choices; every currency but the fee currency to tick.
    expect([...html.matchAll(/type="radio"/g)]).toHaveLength(5)
    expect([...html.matchAll(/type="checkbox"/g)]).toHaveLength(partnerCurrencies.length - 1)
    expect(textOf(html)).toContain(words.invitations.send.label)
    expect(textOf(html)).toContain(words.invitations.hold.label)
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('<dialog')
  })

  it('ties every label to its input and starts with the invitation sent', async () => {
    const html = await render()
    for (const [, id] of html.matchAll(/<label for="([^"]+)"/g)) expect(html).toContain(`id="${id ?? ''}"`)
    expect(html).toMatch(/checked="" value="send"/)
  })

  it('marks each invalid field and points it at its error (?state=invalid)', async () => {
    const html = await render('invalid')
    expect(textOf(html)).toContain(words.errors.nameRequired)
    expect(textOf(html)).toContain(words.errors.emailInvalid)
    expect(textOf(html)).toContain(words.errors.countryRequired)
    expect([...html.matchAll(/aria-invalid="true"/g)]).toHaveLength(3)
    for (const [, id] of html.matchAll(/<p id="([^"]+-error)"/g)) expect(html).toMatch(new RegExp(`aria-describedby="[^"]*${id ?? ''}`))
  })

  it('shows a taken name on the name field (?state=refused)', async () => {
    const html = await render('refused')
    expect(textOf(html)).toContain(words.errors.NAME_TAKEN)
    expect([...html.matchAll(/aria-invalid="true"/g)]).toHaveLength(1)
  })

  it('shows no form to a role that may not create, with the API’s reason (?state=denied)', async () => {
    for (const html of [await render('denied'), await render(null, { allowed: false, reason: 'PARTNER_ADMINS_ONLY' })]) {
      expect(html).not.toContain('<form')
      expect(textOf(html)).toContain(words.denied.title)
      expect(textOf(html)).toContain('Only a Super admin or Partner manager can create partners.')
    }
  })
})

describe('refusalOf', () => {
  it('words a refusal by its code and never by its message', () => {
    expect(refusalOf(new ApiError('NAME_TAKEN', 'anything'))).toEqual({ errors: { name: 'NAME_TAKEN' } })
    expect(refusalOf(new ApiError('INVALID_INPUT', 'leaks internals'))).toEqual({ failure: messages.common.failures.INVALID_INPUT })
    expect(refusalOf(new ApiError('SOMETHING_NEW', 'leaks internals'))).toEqual({ failure: words.failed })
    expect(refusalOf(new Error('network'))).toEqual({ failure: words.failed })
  })
})

describe('draftErrors', () => {
  it('asks for every field, a full email and a name of at most 120 characters', () => {
    expect(draftErrors(emptyDraft)).toEqual({ name: 'nameRequired', ownerEmail: 'emailInvalid', country: 'countryRequired' })
    expect(draftErrors({ ...emptyDraft, name: 'x'.repeat(121), ownerEmail: 'owner@company', country: 'DE' })).toEqual({ name: 'nameTooLong', ownerEmail: 'emailInvalid' })
    expect(draftErrors({ ...emptyDraft, name: ' Kaufladen ', ownerEmail: ' owner@kaufladen.example ', country: 'DE', invitation: 'hold' })).toEqual({})
  })
})
