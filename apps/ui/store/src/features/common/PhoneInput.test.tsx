// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { Field } from './fields'

afterEach(cleanup)

const Phone = ({ start, seen, readOnly = false }: { start: string; seen: string[]; readOnly?: boolean }) => {
  const [value, setValue] = useState(start)
  return (
    <Field
      look="profile"
      label="Mobile number"
      type="tel"
      value={value}
      readOnly={readOnly}
      onValue={(v) => {
        seen.push(v)
        setValue(v)
      }}
    />
  )
}

const code = () => screen.getByLabelText(messages.phone.countryCode) as HTMLSelectElement
const number = () => screen.getByLabelText('Mobile number') as HTMLInputElement

describe('a mobile number field', () => {
  it('hands back the E.164 the API checks, with no spaces', () => {
    const seen: string[] = []
    render(<Phone start="" seen={seen} />)
    fireEvent.change(code(), { target: { value: 'IN' } })
    fireEvent.change(number(), { target: { value: '98765 43210' } })
    expect(seen.at(-1)).toBe('+919876543210')
    expect(code().selectedOptions[0]?.textContent).toBe('+91')
  })

  it('shows a saved number under its own country', () => {
    render(<Phone start="+447946095800" seen={[]} />)
    expect(code().value).toBe('GB')
    expect(number().value).toBe('7946095800')
  })

  it('moves the number to the country picked', () => {
    const seen: string[] = []
    render(<Phone start="+919876543210" seen={seen} />)
    fireEvent.change(code(), { target: { value: 'AE' } })
    expect(seen.at(-1)).toBe('+9719876543210')
  })

  it('passes the input’s own props through, so a disabled field takes no number', () => {
    render(<Field look="profile" label="Mobile number" type="tel" value="+919876543210" onValue={() => undefined} disabled name="mobile" />)
    expect(code().disabled).toBe(true)
    expect(number().disabled).toBe(true)
    expect(number().name).toBe('mobile')
  })

  it('locks the country code with the number when it is read-only', () => {
    render(<Phone start="+919876543210" seen={[]} readOnly />)
    expect(code().disabled).toBe(true)
    expect(number().readOnly).toBe(true)
  })
})
