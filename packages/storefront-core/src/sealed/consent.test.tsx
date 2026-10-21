// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readConsent } from '../platform/consent/consent'
import { createI18n } from '../platform/i18n/i18n'
import { ConsentBanner, ConsentSettingsButton } from './components'
import { focusedElement, rootOf } from './element'

const { t } = createI18n('en-US')

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** Testing Library's queries inside a sealed component's closed root, which only core's own tests can reach. */
const inside = (part: string) => {
  const host = document.querySelector(`df-sealed[data-df-sealed="${part}"]`)
  const root = host && rootOf(host)
  if (!root) throw new Error(`No ${part} root.`)
  return within(root as unknown as HTMLElement)
}

describe('ConsentBanner', () => {
  it('is a labelled region that takes no focus until the shopper opens a step', () => {
    render(<ConsentBanner t={t} />)
    const banner = inside('consent')
    const region = banner.getByRole('region', { name: 'Cookies on this site' })
    expect(region.contains(focusedElement(document))).toBe(false)
    fireEvent.click(banner.getByRole('button', { name: 'Choose' }))
    expect(focusedElement(document)).toBe(banner.getByRole('checkbox', { name: 'Measuring visits' }))
  })

  it('reopens from "Cookie settings" with the saved choice, so consent can be withdrawn', () => {
    render(
      <>
        <ConsentBanner t={t} />
        <ConsentSettingsButton t={t} />
      </>,
    )
    fireEvent.click(inside('consent').getByRole('button', { name: 'Accept all' }))
    expect(document.querySelector('df-sealed[data-df-sealed="consent"]')?.getAttribute('data-df-state')).toBe('closed')
    const settings = inside('consent-settings').getByRole('button', { name: 'Cookie settings' })
    settings.focus()
    act(() => fireEvent.click(settings))
    const banner = inside('consent')
    const analytics = banner.getByRole('checkbox', { name: 'Measuring visits' })
    expect((analytics as HTMLInputElement).checked).toBe(true)
    fireEvent.click(analytics)
    fireEvent.click(banner.getByRole('button', { name: 'Save choices' }))
    expect(readConsent()).toMatchObject({ analytics: false, marketing: true })
    expect(focusedElement(document)).toBe(settings)
  })
})
