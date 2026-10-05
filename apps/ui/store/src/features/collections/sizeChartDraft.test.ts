import { describe, expect, it } from 'vitest'
import type { SizeChart } from '../../api/sizeCharts'
import { chartInput, chartProblem, draftOfChart, inUnit, isChartDirty, templates, withMeasurement, withoutColumn, withRow, withSystems } from './sizeChartDraft'

const chart: SizeChart = {
  id: 'c1',
  name: 'Tops',
  unit: 'cm',
  systems: ['UK'],
  measurements: ['Chest', 'Fit'],
  rows: [
    { size: 'M', values: ['10', '96–101', 'Slim'] },
    { size: 'L', values: ['12', '—', 'Slim'] },
  ],
  howToMeasure: [{ measurement: 'Chest', text: 'Around the fullest part' }],
  fitNotes: null,
  modelInfo: 'Model wears M',
  revision: 3,
  products: 2,
  supplierId: null,
}

describe('a size chart being edited', () => {
  it('shows "—" as an empty cell and sends an empty cell as "—", keeping what the screen doesn’t draw', () => {
    const d = draftOfChart(chart)
    expect(d.rows[1]?.values).toEqual(['12', '', 'Slim'])
    expect(chartInput(d)).toEqual({ name: 'Tops', unit: 'cm', systems: ['UK'], measurements: ['Chest', 'Fit'], rows: chart.rows, howToMeasure: chart.howToMeasure, fitNotes: null, modelInfo: 'Model wears M' })
    expect(isChartDirty(d, draftOfChart(chart))).toBe(false)
  })

  it('converts measurements and ranges to the other unit, never sizes, size systems or words', () => {
    const inches = inUnit(draftOfChart(chart), 'in')
    expect(inches.unit).toBe('in')
    expect(inches.rows[0]).toEqual({ size: 'M', values: ['10', '37.8–39.8', 'Slim'] })
    expect(inUnit(inches, 'cm').rows[0]?.values[1]).toBe('96–101.1')
  })

  it('adds sizes, measurements and empty US/UK/EU columns, and removes a column with its cells', () => {
    const d = draftOfChart(chart)
    expect(withRow(d).rows.at(-1)).toEqual({ size: '', values: ['', '', ''] })
    expect(withMeasurement(d, 'Length').rows[0]?.values).toEqual(['10', '96–101', 'Slim', ''])
    const systems = withSystems(d)
    expect([systems?.systems, systems?.rows[0]?.values]).toEqual([['UK', 'US', 'EU'], ['10', '', '', '96–101', 'Slim']])
    expect(withSystems({ ...d, systems: ['us', 'UK', 'EU'] })).toBeNull()
    expect(withoutColumn(d, 1)).toEqual(expect.objectContaining({ systems: ['UK'], measurements: ['Fit'], rows: [{ size: 'M', values: ['10', 'Slim'] }, { size: 'L', values: ['12', 'Slim'] }] }))
  })

  it('says what the API would refuse before it does', () => {
    const d = draftOfChart(chart)
    expect(chartProblem(d)).toBeNull()
    expect(chartProblem({ ...d, name: ' ' })).toBe('name')
    expect(chartProblem({ ...d, measurements: ['Chest', ''] })).toBe('columns')
    expect(chartProblem({ ...d, measurements: ['Chest', 'chest'] })).toBe('duplicate')
    expect(chartProblem({ ...d, rows: [{ size: '', values: ['1', '2', '3'] }] })).toBe('sizes')
  })
})

describe('the templates', () => {
  it('start in the store’s unit, with kurtas only where it sells in India', () => {
    expect(templates('cm', false).map((t) => t.key)).toEqual(['tops', 'women', 'jeans', 'shoes', 'blank'])
    expect(templates('cm', true).map((t) => t.key)).toContain('kurta')
    const tops = (unit: 'cm' | 'in') => templates(unit, false)[0]?.chart.rows[0]?.values
    expect([tops('cm'), tops('in')]).toEqual([['86', '71', '68'], ['34', '28', '27']])
    // Every row has a value for each size system and measurement, as the API requires.
    for (const t of templates('in', true)) for (const r of t.chart.rows) expect(r.values).toHaveLength(t.chart.systems.length + t.chart.measurements.length)
  })
})
