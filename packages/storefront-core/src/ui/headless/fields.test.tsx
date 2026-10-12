// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Checkbox, SearchField, Select } from './fields'

afterEach(cleanup)

describe('the headless fields', () => {
  it('hands the search words over on submit, without posting the page', () => {
    const onSearch = vi.fn()
    render(<SearchField label="Search" button="Go" value="" onSearch={onSearch} />)
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'linen shirt' } })
    const submitted = fireEvent.submit(screen.getByRole('search'))
    expect(onSearch).toHaveBeenCalledWith('linen shirt')
    expect(submitted).toBe(false)
  })

  it('reports a choice and a tick', () => {
    const onSort = vi.fn()
    const onTick = vi.fn()
    render(
      <>
        <Select label="Sort" value="featured" options={[{ value: 'featured', label: 'Featured' }, { value: 'name', label: 'Name' }]} onChange={onSort} />
        <Checkbox checked={false} onChange={onTick}>
          Linen
        </Checkbox>
      </>,
    )
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } })
    fireEvent.click(screen.getByLabelText('Linen'))
    expect(onSort).toHaveBeenCalledWith('name')
    expect(onTick).toHaveBeenCalledWith(true)
  })
})
