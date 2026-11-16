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

describe('the confirm dialog’s choices (#1453)', () => {
  const show = (hint: boolean, target = 'Item') => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Stop selling it?"
        target={target}
        consequence="Other versions stay."
        confirmLabel="Apply"
        cancelLabel="Cancel"
        choices={[
          {
            key: 'how',
            label: 'How',
            options: [
              { value: 'a', label: 'First', ...(hint ? { hint: 'First line', confirmLabel: 'Hide' } : {}) },
              { value: 'b', label: 'Second', ...(hint ? { hint: 'Second line', confirmLabel: 'Remove' } : {}) },
            ],
            initial: 'a',
            error: () => null,
          },
        ]}
        onConfirm={(_reason, _value, picks) => onConfirm(picks['how'])}
        onCancel={() => undefined}
      />,
    )
    return onConfirm
  }

  it('shows radio boxes with a line under each option when options carry one, with the confirm label following the pick', () => {
    const onConfirm = show(true, '')
    expect(screen.getByText('First line')).toBeTruthy()
    expect(screen.getByText('Second line')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /First/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Second/ }))
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalledWith('b')
  })

  it('leaves a choice without lines as a dropdown with the one confirm label, and shows a target only when given one', () => {
    show(false, 'Item')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'How' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy()
    expect(screen.getByText('Item')).toBeTruthy()
  })
})

describe('the confirm dialog’s size (#1352)', () => {
  const Sized = ({ wide }: { wide?: boolean }) => (
    <ConfirmDialog open title="Invite a supplier" target="Step 3 of 3" consequence="They never see your customers." confirmLabel="Send the invite" cancelLabel="Cancel" {...(wide === undefined ? {} : { wide })} onConfirm={() => undefined} onCancel={() => undefined} />
  )
  const dialog = () => document.querySelector('dialog') as HTMLDialogElement

  it('is the usual size by default, and only wide when asked', () => {
    render(<Sized />)
    expect(dialog().className).toBe('df-dialog')
    cleanup()
    render(<Sized wide={false} />)
    expect(dialog().className).toBe('df-dialog')
    cleanup()
    render(<Sized wide />)
    expect(dialog().className).toBe('df-dialog df-dialog--wide')
  })
})

describe('where the confirm dialog puts the cursor, and Enter (#1470)', () => {
  const open = (extra: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open title="Add to Fabric" target="Fabric" consequence="" confirmLabel="Add" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} {...extra} />)
    return { onConfirm, onCancel }
  }
  const value = { label: 'New value', type: 'text' as const, initial: '', error: (v: string) => (v.trim() === '' ? 'Type a value.' : null) }

  it('starts in the text box, and Enter adds a valid value as the button does', () => {
    const { onConfirm } = open({ input: value })
    const box = screen.getByLabelText('New value') as HTMLInputElement
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: 'Bamboo' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith(null, 'Bamboo', {})
  })

  it('keeps the window open on Enter with an empty value, with the message the button waits on', () => {
    const { onConfirm } = open({ input: value })
    const box = screen.getByLabelText('New value')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Type a value.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('still closes on Cancel and on Escape without confirming', () => {
    const { onConfirm, onCancel } = open({ input: value })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByLabelText('New value'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('starts on Cancel with no text box, so Enter never confirms by accident', () => {
    open()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('starts in the reason box or the type-to-confirm box, and Enter there confirms nothing', () => {
    const { onConfirm } = open({ reason: { label: 'Why', hint: 'Say why' }, typeToConfirm: { label: 'Type it', hint: 'Type Fabric', expected: 'Fabric' } })
    const why = screen.getByLabelText('Why')
    expect(document.activeElement).toBe(why)
    fireEvent.change(why, { target: { value: 'Because' } })
    fireEvent.keyDown(why, { key: 'Enter' })
    const typed = screen.getByLabelText('Type it')
    fireEvent.change(typed, { target: { value: 'Fabric' } })
    fireEvent.keyDown(typed, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
    cleanup()
    open({ typeToConfirm: { label: 'Type it', hint: 'Type Fabric', expected: 'Fabric' } })
    expect(document.activeElement).toBe(screen.getByLabelText('Type it'))
  })
})
