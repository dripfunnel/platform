import type { SizeChart as Chart } from '../../products/product'

export type ChartUnit = 'cm' | 'in'

// Lengths are cm ↔ in, and a weight column (named for weight, kg or lb) is kg ↔ lb: kg when the chart is saved in cm, lb when in inches.
// The portal's sizeChartDraft.ts `inUnit` is the same rule; it can't import core, so keep the two together (#1571).
const cmPerInch = 2.54
const lbPerKg = 2.2046
const number = /^\d+(\.\d+)?([–-]\d+(\.\d+)?)?$/
const weightName = /weight|\bkg\b|\blbs?\b/i

const scaled = (value: string, factor: number): string => {
  const v = value.trim()
  if (!number.test(v)) return value
  return v
    .split(/([–-])/)
    .map((part) => (/^[\d.]+$/.test(part) ? String(Math.round(Number(part) * factor * 10) / 10) : part))
    .join('')
}

/** The chart's measurements and rows in `shown`, from the numbers as saved, so switching back is exactly the merchant's own. Sizes, systems and words are left as typed. */
export const chartIn = (chart: Chart, saved: ChartUnit, shown: ChartUnit): Pick<Chart, 'measurements' | 'rows'> => {
  if (shown === saved) return { measurements: chart.measurements, rows: chart.rows }
  const toCm = shown === 'cm'
  const weight = chart.measurements.map((m) => weightName.test(m))
  const factors = weight.map((w) => (w ? (toCm ? 1 / lbPerKg : lbPerKg) : toCm ? cmPerInch : 1 / cmPerInch))
  const measurements = chart.measurements.map((m, i) => (weight[i] ? m.replace(toCm ? /\blbs?\b/gi : /\bkg\b/gi, toCm ? 'kg' : 'lb') : m))
  const rows = chart.rows.map((r) => {
    // A chart's size systems come before its measurements in a row; only the last cells are measurements.
    const lead = Math.max(0, r.values.length - chart.measurements.length)
    return { ...r, values: r.values.map((v, j) => (j < lead ? v : scaled(v, factors[j - lead] ?? 1))) }
  })
  return { measurements, rows }
}
