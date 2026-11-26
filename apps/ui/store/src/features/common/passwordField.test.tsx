// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PasswordField } from '../auth/fields'
import { messages } from '../../messages'

// The signed-out pages keep their written Show and Hide while My profile draws the eye (#1747).

afterEach(cleanup)

describe('the auth look of a password box', () => {
  it('toggles with the words Show and Hide, as before', () => {
    render(<PasswordField label="Password" value="secret" onValue={() => undefined} />)
    const box = screen.getByLabelText('Password') as HTMLInputElement
    expect(box.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: messages.auth.show }))
    expect(box.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: messages.auth.hide }))
    expect(box.type).toBe('password')
  })
})
