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

describe('the confirm dialog with fields of the caller’s own and a failed confirm', () => {
  const Failing = ({ onConfirm }: { onConfirm: () => void }) => {
    const [error, setError] = useState<string | null>(null)
    return (
      <ConfirmDialog
        open
        title="Change the plan?"
        target="Northstar"
        consequence="Stores move at renewal."
        confirmLabel="Change"
        cancelLabel="Cancel"
        reason={{ label: 'Reason', hint: 'Kept in the log.' }}
        error={error}
        onConfirm={() => {
          onConfirm()
          setError('The plan was retired meanwhile. Nothing was changed.')
        }}
        onCancel={() => undefined}
      >
        <label>
          Note <input defaultValue="kept" />
        </label>
      </ConfirmDialog>
    )
  }

  it('shows the fields, stays open on failure with the reason kept, says why, and can confirm again', async () => {
    const onConfirm = vi.fn()
    render(<Failing onConfirm={onConfirm} />)
    expect((screen.getByLabelText('Note') as HTMLInputElement).value).toBe('kept')
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Asked by the owner' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change', hidden: true })))
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe('The plan was retired meanwhile. Nothing was changed.')
    expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe('Asked by the owner')
    expect((screen.getByRole('button', { name: 'Change', hidden: true }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change', hidden: true })))
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })
})

describe('the confirm dialog waiting on fields of the caller’s own', () => {
  const Blocked = ({ onConfirm }: { onConfirm: () => void }) => {
    const [key, setKey] = useState('')
    return (
      <ConfirmDialog open title="Connect Razorpay" target="" consequence="Paste the keys." confirmLabel="Connect" cancelLabel="Cancel" blocked={key ? null : 'Paste every key.'} onConfirm={onConfirm} onCancel={() => undefined}>
        <label>
          Key id <input value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
      </ConfirmDialog>
    )
  }

  it('says why confirm waits, and confirms once the fields will do', async () => {
    const onConfirm = vi.fn()
    render(<Blocked onConfirm={onConfirm} />)
    const connect = screen.getByRole('button', { name: 'Connect', hidden: true }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    expect(document.getElementById(connect.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Paste every key.')
    fireEvent.change(screen.getByLabelText('Key id'), { target: { value: 'rzp_live_abc123' } })
    expect(connect.disabled).toBe(false)
    expect(screen.queryByText('Paste every key.')).toBeNull()
    await act(async () => fireEvent.click(connect))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
