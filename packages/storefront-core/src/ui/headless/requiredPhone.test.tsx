// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { store } from '../../../test/shop'
import { addressProblems, type AddressDraft, type AddressField, type FieldProblem } from '../../checkout/address'
import { addressDraft } from '../../checkout/checkout'
import { createShopClient } from '../../platform/api/client'
import { createI18n } from '../../platform/i18n/i18n'
import { StorefrontProvider } from '../../platform/store/context'
import { AddressFields } from './form'

const { t } = createI18n('en-US')

afterEach(cleanup)

// A Continue that judges the draft as checkout does: a fresh errors object on every press, even when the problem is the same.
const Step = () => {
  const [value, setValue] = useState<AddressDraft>({ ...addressDraft(null, 'IN'), name: 'Asha Rao', line1: '12 MG Road', city: 'Pune', region: 'Maharashtra', postalCode: '411001' })
  const [errors, setErrors] = useState<Partial<Record<AddressField, FieldProblem>>>({})
  return (
    <>
      <AddressFields value={value} onChange={setValue} countries={['IN', 'US']} errors={errors} t={t} locale="en-US" />
      <button type="button" onClick={() => setErrors(addressProblems(value))}>
        Continue
      </button>
    </>
  )
}

const phone = () => screen.getByLabelText(/^Phone for delivery/) as HTMLInputElement
const press = () => act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Continue' })))

const show = () =>
  render(
    <StorefrontProvider value={{ client: createShopClient(), store: { ...store, mapFrame: null }, locale: 'en-US', mode: 'live', poweredBy: null }}>
      <Step />
    </StorefrontProvider>,
  )

describe('the delivery phone in the address form', () => {
  it('is marked required (its label ends in the mark, not "Optional")', () => {
    show()
    expect(screen.getByLabelText('Phone for delivery *')).toBe(phone())
    expect(phone().getAttribute('aria-required')).toBe('true')
  })

  it('stops an empty Continue on the field with its message, and takes focus on every refused press', async () => {
    show()
    await press()
    expect(screen.getByRole('alert').textContent).toBe('Add a phone number for delivery.')
    expect(phone().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(phone())
    screen.getByRole('button', { name: 'Continue' }).focus()
    await press()
    expect(document.activeElement).toBe(phone())
  })

  it('leaves focus alone when a field above the phone is wrong too, so the first problem is not skipped', async () => {
    show()
    fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: '' } })
    screen.getByRole('button', { name: 'Continue' }).focus()
    await press()
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('Add a phone number for delivery.')
    expect(document.activeElement).not.toBe(phone())
  })

  it('says a wrong number is wrong, as before, and shows no message once it is right', async () => {
    show()
    fireEvent.change(phone(), { target: { value: '12' } })
    await press()
    expect(screen.getByRole('alert').textContent).toBe('Check the country code and the number.')
    fireEvent.change(phone(), { target: { value: '9876543210' } })
    await press()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
