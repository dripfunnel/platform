// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { addressDraft } from '../../checkout/checkout'
import type { AddressDraft } from '../../checkout/address'
import { createI18n } from '../../platform/i18n/i18n'
import { AddressFields, PhoneField } from './form'

const { t } = createI18n('en-US')
afterEach(cleanup)

const Fields = ({ start, errors = {} }: { start: AddressDraft; errors?: Parameters<typeof AddressFields>[0]['errors'] }) => {
  const [value, setValue] = useState(start)
  return <AddressFields value={value} onChange={setValue} countries={['US', 'IN']} errors={errors} t={t} locale="en-US" />
}

describe('AddressFields', () => {
  it('asks for a country when none is chosen, and says so when it is missing', () => {
    render(<Fields start={addressDraft(null, '')} errors={{ country: 'required' }} />)
    const select = screen.getByLabelText('Country') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a country', 'United States', 'India'])
    expect(screen.getByRole('alert').textContent).toBe('Fill this in.')
    fireEvent.change(select, { target: { value: 'IN' } })
    expect(screen.getByLabelText('PIN code')).toBeTruthy()
    expect([...select.options].map((o) => o.value)).toEqual(['US', 'IN'])
  })

  it('names the fields each country needs, and which are optional', () => {
    render(<Fields start={addressDraft(null, 'US')} />)
    expect(screen.getByLabelText('ZIP code')).toBeTruthy()
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
