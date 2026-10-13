// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { addressDraft } from '../../checkout/checkout'
import type { AddressDraft } from '../../checkout/address'
import { createI18n } from '../../platform/i18n/i18n'
import { AddressFields } from './form'

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
