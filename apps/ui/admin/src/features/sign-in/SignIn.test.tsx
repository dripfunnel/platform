import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { SignIn } from './SignIn'
import { problemStates, signInOutcomes, signInStates, walksThrough } from './signInStates'

const words = messages.signIn

const htmlText = (text: string) => text.replace(/'/g, '&#x27;')
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const render = async (search = '') => {
  const rootRoute = createRootRoute({ component: SignIn })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: [`/${search}`] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('SignIn', () => {
  it('starts with the Microsoft button when no state is forced', async () => {
    const text = textOf(await render())
    expect(text).toContain(words.states.start.title)
    expect(text).toContain(words.microsoftButton)
    expect(text).toContain(words.footer)
  })

  it.each(signInStates)('renders the %s state through ?state=', async (state) => {
    const text = textOf(await render(`?state=${state}`))
    expect(text).toContain(words.states[state].title)
    expect(text).toContain(words.states[state].body)
  })

  it.each(signInOutcomes)('shows the %s outcome the Worker reports', async (outcome) => {
    // ?outcome= is the real sign-in result, so unlike ?state= it is read in production too.
    const text = textOf(await render(`?outcome=${outcome}`))
    expect(text).toContain(words.states[outcome].title)
  })

  it('ignores an outcome the Worker could not have sent', async () => {
    // Only the callback's own vocabulary, so a link cannot drive the screen anywhere else.
    expect(textOf(await render('?outcome=signing'))).toContain(words.states.start.title)
    expect(textOf(await render('?outcome=nonsense'))).toContain(words.states.start.title)
  })

  it('ignores a state the screen does not have', async () => {
    expect(textOf(await render('?state=empty'))).toContain(words.states.start.title)
  })

  it.each(problemStates)('explains %s as an alert and offers to try again', async (state) => {
    const html = await render(`?state=${state}`)
    expect(html).toMatch(new RegExp(`role="alert"[^>]*>${escapeRegExp(htmlText(words.states[state].detail))}<`))
    expect(textOf(html)).toContain(words.tryAgain)
  })

  it('shows the number to tap and the way round it when approving', async () => {
    const text = textOf(await render('?state=approve'))
    expect(text).toContain(words.states.approve.tapNumber)
    expect(text).toContain(words.states.approve.useCode)
  })

  it('asks for a one-time code, and says why Verify is off until it is complete', async () => {
    const html = await render('?state=code')
    expect(html).toMatch(/autocomplete="one-time-code"/i)
    expect(html).toMatch(/inputmode="numeric"/i)
    const hintId = new RegExp(`<p id="([^"]+)"[^>]*>${words.states.code.codeHint}</p>`).exec(html)?.[1]
    expect(hintId).toBeDefined()
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-describedby="${hintId ?? ''}"`))
  })

  it('offers another account when access is refused', async () => {
    expect(textOf(await render('?state=refused'))).toContain(words.states.refused.action)
  })

  it.each(['', ...signInStates.map((state) => `?state=${state}`)])(
    'never asks for a password (%s)',
    async (search) => {
      expect(await render(search)).not.toContain('type="password"')
    },
  )
})

describe('walksThrough', () => {
  it('goes to Microsoft on a plain address, even under vite dev', () => {
    expect(walksThrough(null)).toBe(false)
  })

  it.each(signInStates)('plays the prototype from ?state=%s', (state) => {
    expect(walksThrough(state)).toBe(true)
  })
})
