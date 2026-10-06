// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

// The dialog's single-field ask as a password: masked, handed to onConfirm once, and gone after.

afterEach(cleanup)

const Harness = ({ onConfirm }: { onConfirm: (value: string | null) => void }) => {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open again
      </button>
      <ConfirmDialog
        open={open}
        title="Turn off two-step sign-in?"
        target="farhan@example.com"
        consequence="Anyone with your password could then sign in as you."
        confirmLabel="Turn it off"
        cancelLabel="Cancel"
        danger
        input={{ label: 'Your password', type: 'password', initial: '', error: (value) => (value ? null : 'Type your password first.') }}
        onConfirm={(_reason, value) => {
          onConfirm(value)
          setOpen(false)
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}

describe('a password asked in the confirm dialog', () => {
  it('is masked, filled as the current password, and handed over only on confirm', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const field = screen.getByLabelText('Your password') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.autocomplete).toBe('current-password')
    fireEvent.change(field, { target: { value: 'secret pass' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Turn it off', hidden: true })))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('secret pass')
  })

  it('keeps nothing once cancelled: it opens again empty', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'typed then dropped' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel', hidden: true })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open again', hidden: true })))
    expect((screen.getByLabelText('Your password') as HTMLInputElement).value).toBe('')
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
