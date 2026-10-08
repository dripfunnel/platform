// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readConsent } from './consent/consent'
import { createI18n } from './i18n/i18n'
import { ConsentBanner, ConsentSettingsButton } from './required'

const { t } = createI18n('en-US')

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('ConsentBanner', () => {
  it('is a labelled region that takes no focus until the shopper opens a step', () => {
    render(<ConsentBanner t={t} />)
    const region = screen.getByRole('region', { name: 'Cookies on this site' })
    expect(region.contains(document.activeElement)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }))
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Measuring visits' }))
  })

  it('reopens from "Cookie settings" with the saved choice, so consent can be withdrawn', () => {
    render(
      <>
        <ConsentBanner t={t} />
        <ConsentSettingsButton t={t} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(screen.queryByRole('region')).toBeNull()
    const settings = screen.getByRole('button', { name: 'Cookie settings' })
    settings.focus()
    act(() => fireEvent.click(settings))
    const analytics = screen.getByRole('checkbox', { name: 'Measuring visits' })
    expect((analytics as HTMLInputElement).checked).toBe(true)
    fireEvent.click(analytics)
    fireEvent.click(screen.getByRole('button', { name: 'Save choices' }))
    expect(readConsent()).toMatchObject({ analytics: false, marketing: true })
    expect(document.activeElement).toBe(settings)
  })
})
