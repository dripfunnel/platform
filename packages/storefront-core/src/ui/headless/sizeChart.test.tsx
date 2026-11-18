// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Provided } from '../../../test/shop'
import type { SizeChart as Chart } from '../../products/product'
import { SizeChart } from './sizeChart'

// The product page's size chart (#1326): a link, and a modal <dialog> with the chart's table. A theme may write no <dialog>, so core draws it.

beforeAll(() => {
  // happy-dom has no top layer; showModal and close mark the dialog open and shut, as a browser does.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})
afterEach(cleanup)

const chart: Chart = { name: 'Tops & shirts', unit: 'cm', measurements: ['Chest', 'Length'], rows: [{ size: 'S', values: ['86', '68'] }, { size: 'M', values: ['91', '70'] }] }
const drawn = (c: Chart = chart) => (
  <Provided>
    <SizeChart chart={c} className="link" />
  </Provided>
)
const opened = async (c?: Chart) => {
  render(drawn(c))
  const link = screen.getByRole('button', { name: 'Size chart' })
  link.focus()
  fireEvent.click(link)
  return { link, dialog: await screen.findByRole('dialog') }
}

describe('SizeChart', () => {
  it('is a link that opens the chart’s table in a labelled modal, with the unit', async () => {
    render(drawn())
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Size chart' }))
    const dialog = await screen.findByRole('dialog', { name: 'Size chart' })
    const table = within(dialog).getByRole('table', { name: 'Tops & shirts' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Size', 'Chest', 'Length'])
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([['86', '68'], ['91', '70']])
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['S', 'M'])
    expect(within(dialog).getByText('Measurements are in centimetres.')).toBeTruthy()
  })

  it('closes with Close, or as the browser does on Escape, and gives focus back to the link', async () => {
    const { link, dialog } = await opened()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(link)
    fireEvent.click(link)
    fireEvent(await screen.findByRole('dialog'), new Event('close'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(link)
  })

  it('closes on a click outside it, not on one inside', async () => {
    const { dialog } = await opened()
    fireEvent.click(within(dialog).getByRole('table'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(dialog, { clientX: 40, clientY: 40 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('names the unit in inches, and says nothing of one it doesn’t know or a chart without a name', async () => {
    await opened({ ...chart, unit: 'in' })
    expect(screen.getByText('Measurements are in inches.')).toBeTruthy()
    cleanup()
    await opened({ ...chart, unit: null, name: null })
    expect(screen.queryByText(/Measurements are in/)).toBeNull()
    expect(screen.getByRole('table', { name: '' })).toBeTruthy()
  })

  describe('the cm | in switch (#1571)', () => {
    const baby: Chart = {
      name: 'Baby',
      unit: 'cm',
      measurements: ['Baby height', 'Baby weight (kg)', 'Fit'],
      rows: [{ size: '0–3m', values: ['55–61', '4–6', 'Snug'] }, { size: '3–6m', values: ['62', '6.5', 'Roomy'] }],
    }
    const cells = (dialog: HTMLElement) => within(dialog).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
    const heads = (dialog: HTMLElement) => within(dialog).getAllByRole('columnheader').map((h) => h.textContent)

    it('opens in the saved unit, with that unit picked, and offers the other', async () => {
      const { dialog } = await opened(baby)
      expect(within(dialog).getByRole('button', { name: 'cm' }).getAttribute('aria-pressed')).toBe('true')
      expect(within(dialog).getByRole('button', { name: 'in' }).getAttribute('aria-pressed')).toBe('false')
      expect(cells(dialog)[0]).toEqual(['55–61', '4–6', 'Snug'])
      cleanup()
      const inches = await opened({ ...baby, unit: 'in', measurements: ['Baby height', 'Baby weight (lb)', 'Fit'], rows: [{ size: '0–3m', values: ['21.7–24', '8.8–13.2', 'Snug'] }] })
      expect(within(inches.dialog).getByRole('button', { name: 'in' }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByText('Measurements are in inches.')).toBeTruthy()
      fireEvent.click(within(inches.dialog).getByRole('button', { name: 'cm' }))
      expect(cells(inches.dialog)[0]).toEqual(['55.1–61', '4–6', 'Snug'])
      expect(heads(inches.dialog)).toEqual(['Size', 'Baby height', 'Baby weight (kg)', 'Fit'])
      expect(screen.getByText('Measurements are in centimetres.')).toBeTruthy()
    })

    it('converts lengths and ranges, and weights kg ↔ lb with the column’s name, leaving sizes and words as typed', async () => {
      const { dialog } = await opened(baby)
      fireEvent.click(within(dialog).getByRole('button', { name: 'in' }))
      expect(cells(dialog)).toEqual([['21.7–24', '8.8–13.2', 'Snug'], ['24.4', '14.3', 'Roomy']])
      expect(heads(dialog)).toEqual(['Size', 'Baby height', 'Baby weight (lb)', 'Fit'])
      expect(within(dialog).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['0–3m', '3–6m'])
      expect(within(dialog).getByRole('button', { name: 'in' }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByText('Measurements are in inches.')).toBeTruthy()
    })

    it('gives the merchant’s own numbers and names back when switched back', async () => {
      const { dialog } = await opened(baby)
      fireEvent.click(within(dialog).getByRole('button', { name: 'in' }))
      fireEvent.click(within(dialog).getByRole('button', { name: 'cm' }))
      expect(cells(dialog)).toEqual(baby.rows.map((r) => r.values))
      expect(heads(dialog)).toEqual(['Size', ...baby.measurements])
      expect(screen.getByText('Measurements are in centimetres.')).toBeTruthy()
    })

    it('leaves a size system’s cells alone when the row carries them before the measurements', async () => {
      const { dialog } = await opened({ ...baby, measurements: ['Chest'], rows: [{ size: 'M', values: ['10', '96–101'] }] })
      fireEvent.click(within(dialog).getByRole('button', { name: 'in' }))
      expect(cells(dialog)).toEqual([['10', '37.8–39.8']])
    })

    it('switches with the keyboard: the buttons are tab stops that Enter and Space press', async () => {
      const { dialog } = await opened(baby)
      const inches = within(dialog).getByRole('button', { name: 'in' }) as HTMLButtonElement
      expect(inches.type).toBe('button')
      expect(inches.tabIndex).toBe(0)
      inches.focus()
      fireEvent.click(inches)
      expect(inches.getAttribute('aria-pressed')).toBe('true')
      expect(within(dialog).getByRole('group', { name: 'Show measurements in' })).toBeTruthy()
    })

    it('offers no switch for a unit it doesn’t know', async () => {
      const { dialog } = await opened({ ...baby, unit: null })
      expect(within(dialog).queryByRole('group')).toBeNull()
    })
  })

  it('puts only the link in built HTML, not the table', () => {
    const html = renderToString(drawn())
    expect(html).toContain('Size chart')
    expect(html).not.toContain('<table')
  })
})
