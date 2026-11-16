// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchSelect } from './SearchSelect'

const options = [
  { id: 'a', label: 'Fashion & Apparel' },
  { id: 'b', label: 'Footwear' },
  { id: 'c', label: 'Food & Grocery' },
]

const show = (value: string | null = null, disabled = false) => {
  const onChange = vi.fn()
  render(
    <>
      <span id="l">What your shop sells</span>
      <SearchSelect options={options} value={value} onChange={onChange} labelledBy="l" placeholder="Search or pick one" noMatches="No category matches that." disabled={disabled} />
    </>,
  )
  return { onChange, field: screen.getByRole('combobox', { name: 'What your shop sells' }) as HTMLInputElement }
}

afterEach(cleanup)

describe('SearchSelect', () => {
  it('lists every option when opened and filters as you type, ignoring case', () => {
    const { field } = show()
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.focus(field)
    expect(screen.getAllByRole('option')).toHaveLength(3)
    fireEvent.change(field, { target: { value: 'FOO' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Footwear', 'Food & Grocery'])
  })

  it('says when nothing matches', () => {
    const { field } = show()
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No category matches that.')).toBeTruthy()
  })

  it('chooses with the arrow keys and Enter, and closes on Escape without choosing', () => {
    const { field, onChange } = show()
    fireEvent.focus(field)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(field.getAttribute('aria-activedescendant')).toMatch(/-b$/)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(field.getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.focus(field)
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('chooses by click, shows the chosen name, and marks it selected', () => {
    const { field, onChange } = show('c')
    expect(field.value).toBe('Food & Grocery')
    fireEvent.focus(field)
    expect(screen.getByRole('option', { name: 'Food & Grocery' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Footwear' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('stays shut while disabled', () => {
    const { field } = show(null, true)
    fireEvent.focus(field)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
