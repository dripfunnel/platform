import type { SizeChart, SizeChartInput } from '../../api/sizeCharts'

/** A chart as the editor holds it: the size column, then size systems (US, UK…), then measurements. */
export interface ChartDraft {
  id: string | null
  revision: number | null
  name: string
  unit: 'cm' | 'in'
  systems: string[]
  measurements: string[]
  rows: { size: string; values: string[] }[]
  fitNotes: string
  /** Kept as they are: the prototype draws neither. */
  howToMeasure: SizeChart['howToMeasure']
  modelInfo: string | null
}

/** What a blank cell is sent and shown as: the API needs a value in every cell, and "—" is how CatSizeCharts shows none. */
export const noValue = '—'

export const draftOfChart = (c: SizeChart): ChartDraft => ({
  id: c.id,
  revision: c.revision,
  name: c.name,
  unit: c.unit,
  systems: [...c.systems],
  measurements: [...c.measurements],
  rows: c.rows.map((r) => ({ size: r.size, values: r.values.map((v) => (v === noValue ? '' : v)) })),
  fitNotes: c.fitNotes ?? '',
  howToMeasure: c.howToMeasure,
  modelInfo: c.modelInfo,
})

export const chartInput = (d: ChartDraft): SizeChartInput => ({
  name: d.name.trim(),
  unit: d.unit,
  systems: d.systems.map((s) => s.trim()),
  measurements: d.measurements.map((m) => m.trim()),
  rows: d.rows.map((r) => ({ size: r.size.trim() || noValue, values: r.values.map((v) => v.trim() || noValue) })),
  howToMeasure: d.howToMeasure.filter((h) => d.measurements.includes(h.measurement)),
  fitNotes: d.fitNotes.trim() || null,
  modelInfo: d.modelInfo,
})

export const isChartDirty = (d: ChartDraft, saved: ChartDraft): boolean => JSON.stringify(chartInput(d)) !== JSON.stringify(chartInput(saved))

/** Why a chart can't be saved yet, or null: what the API would refuse, said before it does. */
export type ChartProblem = 'name' | 'columns' | 'sizes' | 'duplicate'
export const chartProblem = (d: ChartDraft): ChartProblem | null => {
  if (d.name.trim() === '') return 'name'
  const heads = [...d.systems, ...d.measurements].map((h) => h.trim())
  if (d.measurements.length === 0 || heads.some((h) => h === '')) return 'columns'
  if (new Set(d.measurements.map((m) => m.trim().toLowerCase())).size !== d.measurements.length) return 'duplicate'
  if (d.rows.length === 0 || d.rows.some((r) => r.size.trim() === '')) return 'sizes'
  return null
}

const numeric = /^\d+(\.\d+)?([–-]\d+(\.\d+)?)?$/

/** The measurements in the other unit, rounded to one decimal; sizes, size systems and words stay as typed. */
export const inUnit = (d: ChartDraft, unit: 'cm' | 'in'): ChartDraft => {
  if (unit === d.unit) return d
  const factor = unit === 'cm' ? 2.54 : 1 / 2.54
  const convert = (v: string) =>
    numeric.test(v.trim())
      ? v
          .trim()
          .split(/([–-])/)
          .map((part) => (/^[\d.]+$/.test(part) ? String(Math.round(Number(part) * factor * 10) / 10) : part))
          .join('')
      : v
  return { ...d, unit, rows: d.rows.map((r) => ({ ...r, values: r.values.map((v, i) => (i < d.systems.length ? v : convert(v))) })) }
}

export const withRow = (d: ChartDraft): ChartDraft => ({ ...d, rows: [...d.rows, { size: '', values: [...d.systems, ...d.measurements].map(() => '') }] })

export const withMeasurement = (d: ChartDraft, name: string): ChartDraft => ({ ...d, measurements: [...d.measurements, name], rows: d.rows.map((r) => ({ ...r, values: [...r.values, ''] })) })

/** US, UK and EU columns, empty for the merchant to fill: the prototype's made-up numbers aren't (INCOMPLETE-FEATURES). */
export const withSystems = (d: ChartDraft): ChartDraft | null => {
  const add = ['US', 'UK', 'EU'].filter((s) => !d.systems.some((x) => x.toUpperCase() === s))
  if (add.length === 0) return null
  const at = d.systems.length
  return { ...d, systems: [...d.systems, ...add], rows: d.rows.map((r) => ({ ...r, values: [...r.values.slice(0, at), ...add.map(() => ''), ...r.values.slice(at)] })) }
}

/** Column `i` of the systems-then-measurements columns gone, with its cells. */
export const withoutColumn = (d: ChartDraft, i: number): ChartDraft => ({
  ...d,
  systems: d.systems.filter((_, j) => j !== i),
  measurements: d.measurements.filter((_, j) => j + d.systems.length !== i),
  rows: d.rows.map((r) => ({ ...r, values: r.values.filter((_, j) => j !== i) })),
})

export type TemplateKey = 'tops' | 'women' | 'jeans' | 'shoes' | 'kurta' | 'blank'

/** CatSizeCharts' starting points, in the store's unit; kurtas where the store sells in India. */
export const templates = (unit: 'cm' | 'in', india: boolean): { key: TemplateKey; chart: Pick<ChartDraft, 'systems' | 'measurements' | 'rows'> }[] => {
  const inch = unit === 'in'
  const sizes = ['S', 'M', 'L', 'XL', 'XXL']
  const row = (size: string, values: (string | number)[]) => ({ size, values: values.map(String) })
  return [
    { key: 'tops', chart: { systems: [], measurements: ['Chest', 'Waist', 'Length'], rows: sizes.map((s, i) => row(s, inch ? [34 + i * 2, 28 + i * 2, 27 + i] : [86 + i * 5, 71 + i * 5, 68 + i * 2])) } },
    {
      key: 'women',
      chart: { systems: ['UK', 'EU'], measurements: ['Bust', 'Waist'], rows: [['2', '6', '34'], ['4', '8', '36'], ['6', '10', '38'], ['8', '12', '40'], ['10', '14', '42']].map(([us = '', uk = '', eu = ''], i) => row(us, [uk, eu, ...(inch ? [32 + i, 25 + i] : [81 + i * 3, 64 + i * 3])])) },
    },
    { key: 'jeans', chart: { systems: [], measurements: ['Waist', 'Leg'], rows: ['28×30', '30×32', '32×32', '34×32'].map((s) => row(s, s.split('×').map((n) => (inch ? n : String(Math.round(Number(n) * 2.54)))))) } },
    { key: 'shoes', chart: { systems: ['UK', 'EU', 'JP'], measurements: ['Foot'], rows: [['7', '6', '40', '25', inch ? '9.6' : '24.4'], ['8', '7', '41', '26', inch ? '9.9' : '25.2'], ['9', '8', '42', '27', inch ? '10.2' : '26']].map(([us = '', ...rest]) => row(us, rest)) } },
    ...(india ? [{ key: 'kurta' as const, chart: { systems: [], measurements: ['Chest', 'Length', 'Shoulder'], rows: sizes.map((s, i) => row(s, [96 + i * 5, 107 + i * 2, 38 + i].map((cm) => (inch ? Math.round((cm / 2.54) * 10) / 10 : cm)))) } }] : []),
    { key: 'blank', chart: { systems: [], measurements: ['Measurement'], rows: [row('', [''])] } },
  ]
}
