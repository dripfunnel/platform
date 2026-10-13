// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeField } from './fields'

afterEach(cleanup)

const field = () => screen.getByLabelText('Discount code') as HTMLInputElement
const apply = async (value: string) => {
  fireEvent.change(field(), { target: { value } })
  await act(async () => void fireEvent.submit(field().closest('form') as HTMLFormElement))
}

describe('CodeField', () => {
  it('sends the trimmed code, never an empty one, and clears it only once it worked', async () => {
    const onApply = vi.fn(async (code: string) => code === 'AUTUMN')
    render(<CodeField label="Discount code" button="Apply" onApply={onApply} />)
    await apply('   ')
    expect(onApply).not.toHaveBeenCalled()
    await apply('  NOPE ')
    expect(onApply).toHaveBeenLastCalledWith('NOPE')
    expect(field().value).toBe('  NOPE ')
    await apply(' AUTUMN ')
    expect(onApply).toHaveBeenLastCalledWith('AUTUMN')
    expect(field().value).toBe('')
  })

  it('holds Apply while asking, and lets it go again when asking failed', async () => {
    let fail: (e: Error) => void = () => undefined
    const onApply = vi.fn(() => new Promise<boolean>((_, reject) => (fail = reject)))
    render(<CodeField label="Discount code" button="Apply" onApply={onApply} />)
    await apply('AUTUMN')
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true)
    await apply('AUTUMN')
    expect(onApply).toHaveBeenCalledTimes(1)
    await act(async () => fail(new Error('network')))
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false)
  })

  it('announces a refusal as an error and a code that worked as a status', () => {
    const { rerender } = render(<CodeField label="Discount code" button="Apply" onApply={async () => false} message="That code isn't valid." refused />)
    expect(screen.getByRole('alert').textContent).toBe("That code isn't valid.")
    expect(field().getAttribute('aria-invalid')).toBe('true')
    rerender(<CodeField label="Discount code" button="Apply" onApply={async () => true} message="Code applied." />)
    expect(screen.getByRole('status').textContent).toBe('Code applied.')
    expect(field().getAttribute('aria-invalid')).toBeNull()
  })
})
