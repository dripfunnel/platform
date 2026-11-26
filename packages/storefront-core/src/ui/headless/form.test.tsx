// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { addressDraft } from '../../checkout/checkout'
import type { AddressDraft } from '../../checkout/address'
import { createI18n } from '../../platform/i18n/i18n'
import { AddressFields, PhoneField, TextField } from './form'

const { t } = createI18n('en-US')
afterEach(cleanup)

const Fields = ({ start, errors = {} }: { start: AddressDraft; errors?: Parameters<typeof AddressFields>[0]['errors'] }) => {
  const [value, setValue] = useState(start)
  return <AddressFields value={value} onChange={setValue} countries={['US', 'IN']} errors={errors} t={t} locale="en-US" />
}

describe('AddressFields', () => {
  it('asks for a country when none is chosen, and says so when it is missing', () => {
    render(<Fields start={addressDraft(null, '')} errors={{ country: 'required' }} />)
    const select = screen.getByLabelText('Country *') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a country', 'United States', 'India'])
    expect(screen.getByRole('alert').textContent).toBe('Fill this in.')
    fireEvent.change(select, { target: { value: 'IN' } })
    expect(screen.getByLabelText('PIN code *')).toBeTruthy()
    expect([...select.options].map((o) => o.value)).toEqual(['US', 'IN'])
  })

  it('names the fields each country needs, and which are optional', () => {
    render(<Fields start={addressDraft(null, 'US')} />)
    expect(screen.getByLabelText('ZIP code *')).toBeTruthy()
    expect(screen.getByText('Apartment, floor, landmark').parentElement?.textContent).toContain('Optional')
  })
})

const Phone = ({ start, country, seen }: { start: string; country: string; seen: string[] }) => {
  const [value, setValue] = useState(start)
  return <PhoneField label="Mobile number" codeLabel="Country code" country={country} locale="en-US" value={value} onChange={(v) => {
        seen.push(v)
        setValue(v)
      }} />
}

describe('autoFocus', () => {
  it('moves focus into a text field and a phone field when they appear, and only when asked', () => {
    const none = render(
      <>
        <TextField label="Code" value="" onChange={() => undefined} />
        <PhoneField label="Number" value="" onChange={() => undefined} country="IN" codeLabel="Country code" locale="en-IN" />
      </>,
    )
    expect(document.activeElement).toBe(document.body)
    none.unmount()
    const text = render(<TextField label="Code" value="" onChange={() => undefined} autoFocus />)
    expect(document.activeElement).toBe(screen.getByLabelText('Code'))
    text.unmount()
    render(<PhoneField label="Number" value="" onChange={() => undefined} country="IN" codeLabel="Country code" locale="en-IN" autoFocus />)
    expect(document.activeElement).toBe(screen.getByLabelText('Number'))
  })
})

describe('PhoneField', () => {
  it('starts in the given country and hands back the number with its code', () => {
    const seen: string[] = []
    render(<Phone start="" country="IN" seen={seen} />)
    const code = screen.getByLabelText('Country code') as HTMLSelectElement
    expect(code.value).toBe('IN')
    expect(code.selectedOptions[0]?.textContent).toBe('+91')
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '98765 43210' } })
    expect(seen.at(-1)).toBe('+919876543210')
    fireEvent.change(code, { target: { value: 'GB' } })
    expect(seen.at(-1)).toBe('+449876543210')
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).value).toBe('9876543210')
  })

  it('shows a saved number in its own country', () => {
    render(<Phone start="+447946095800" country="IN" seen={[]} />)
    expect((screen.getByLabelText('Country code') as HTMLSelectElement).value).toBe('GB')
    expect((screen.getByLabelText('Mobile number') as HTMLInputElement).value).toBe('7946095800')
  })
})

describe('TextField › password', () => {
  const Password = ({ words = true }: { words?: boolean }) => {
    const [value, setValue] = useState('')
    return <TextField label="Password" type="password" value={value} onChange={setValue} {...(words ? { showLabel: 'Show password', hideLabel: 'Hide password' } : {})} />
  }
  const box = () => screen.getByLabelText('Password') as HTMLInputElement

  it('starts hidden, shows on a click and hides on the next, the button naming what it does (#1731)', () => {
    render(<Password />)
    expect(box().type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(box().type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(box().type).toBe('password')
    expect(screen.queryByRole('button', { name: 'Show password' })).toBeTruthy()
  })

  it('keeps what was typed when it shows, and is a plain button the keyboard reaches and Enter or Space press', () => {
    render(<Password />)
    fireEvent.change(box(), { target: { value: 'hunter2hunter2' } })
    const button = screen.getByRole('button', { name: 'Show password' }) as HTMLButtonElement
    expect(button.type).toBe('button')
    expect(button.tabIndex).toBe(0)
    fireEvent.click(button)
    expect(box().value).toBe('hunter2hunter2')
  })

  it('lays the input and the button out with the theme’s classes, and writes no style of its own', () => {
    render(<TextField label="Password" type="password" value="" onChange={() => undefined} showLabel="Show password" hideLabel="Hide password" revealClassName="reveal" toggleClassName="eye" />)
    const button = screen.getByRole('button', { name: 'Show password' })
    expect(button.className).toBe('eye')
    expect(button.parentElement?.className).toBe('reveal')
    expect(button.parentElement?.contains(screen.getByLabelText('Password'))).toBe(true)
    expect(button.hasAttribute('style') || button.parentElement?.hasAttribute('style') || screen.getByLabelText('Password').hasAttribute('style')).toBe(false)
  })

  it('has no button without the theme’s words, and none on a field that is not a password', () => {
    const { unmount } = render(<Password words={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    render(<TextField label="Name" value="" onChange={() => undefined} showLabel="Show password" hideLabel="Hide password" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
