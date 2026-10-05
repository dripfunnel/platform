// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'

// My profile's cards driven as a person would: the password form, and Your activity's paging.

const words = messages.profile
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
  vi.doUnmock('../../api/profile')
})

describe('changing your password', () => {
  it('closes the form and clears its fields once the change is made, and keeps them open on a refusal', async () => {
    const { ApiError } = await import('@dripfunnel/shared/graphql')
    const changePassword = vi.fn().mockRejectedValueOnce(new ApiError('INVALID_CREDENTIALS', 'no')).mockResolvedValueOnce(undefined)
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), changePassword }))
    const { PasswordCard } = await import('./PasswordCard')
    const onChanged = vi.fn()
    render(<PasswordCard changedAt={null} onChanged={onChanged} onToast={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: words.password.open }))
    const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
    typeIn(words.password.current, 'old one')
    typeIn(words.password.next, 'a long new one')
    typeIn(words.password.again, 'a long new one')
    fireEvent.click(screen.getByRole('button', { name: words.password.save }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.twoStep.wrongPassword)
    expect((screen.getByLabelText(words.password.next) as HTMLInputElement).value).toBe('a long new one')
    fireEvent.click(screen.getByRole('button', { name: words.password.save }))
    await settle()
    expect(changePassword).toHaveBeenCalledTimes(2)
    expect(onChanged).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText(words.password.current)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: words.password.open }))
    expect((screen.getByLabelText(words.password.current) as HTMLInputElement).value).toBe('')
  })
})

describe('your activity', () => {
  it('asks for an older page once however fast it is clicked, and keeps the rows when it fails', async () => {
    const entry = (id: string) => ({ id, occurredAt: '2026-10-05T00:00:00.000Z', action: 'person.signed_in', result: 'success' as const, storeId: null, target: null })
    let release: (() => void) | undefined
    const loadMyActivity = vi
      .fn()
      .mockResolvedValueOnce({ entries: [entry('a')], next: 'c1' })
      .mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(new Error('offline')))))
    vi.doMock('../../api/profile', async (actual) => ({ ...(await actual<typeof import('../../api/profile')>()), loadMyActivity }))
    const { MyActivity } = await import('./MyActivity')
    render(<MyActivity storeNames={new Map()} />)
    await settle()
    const more = screen.getByRole('button', { name: words.activity.more })
    fireEvent.click(more)
    fireEvent.click(more)
    await settle()
    expect(loadMyActivity).toHaveBeenCalledTimes(2)
    expect(screen.getByText(words.activity.loading)).toBeTruthy()
    await act(async () => release?.())
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.activity.error)
    expect(screen.getAllByText(words.activity.actions['person.signed_in'])).toHaveLength(1)
  })
})
