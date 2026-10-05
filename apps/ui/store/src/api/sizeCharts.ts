import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// Size charts (CatSizeCharts, CATALOG R): sizes as rows, size systems and measurements as columns.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const summarySchema = z.object({ id: z.string(), name: z.string(), unit: z.enum(['cm', 'in']), products: z.number().int(), supplierId: z.string().nullable() })
export type SizeChartSummary = z.infer<typeof summarySchema>

/** Every chart the caller reads: the merchant side the store's and its suppliers', a supplier its own. */
export const loadSizeChartList = (): Promise<SizeChartSummary[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query C($after: String) { sizeCharts(first: 50, after: $after) { nodes { id name unit products supplierId } pageInfo { hasNextPage endCursor } } }',
          z.object({ sizeCharts: z.object({ nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).sizeCharts,
  )

const chartSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.enum(['cm', 'in']),
  systems: z.array(z.string()),
  measurements: z.array(z.string()),
  rows: z.array(z.object({ size: z.string(), values: z.array(z.string()) })),
  howToMeasure: z.array(z.object({ measurement: z.string(), text: z.string() })),
  fitNotes: z.string().nullable(),
  modelInfo: z.string().nullable(),
  revision: z.number().int(),
  products: z.number().int(),
  supplierId: z.string().nullable(),
})
export type SizeChart = z.infer<typeof chartSchema>

export const loadSizeChart = async (id: string): Promise<SizeChart | null> =>
  (
    await query(
      'query C($id: ID!) { sizeChart(id: $id) { id name unit systems measurements rows { size values } howToMeasure { measurement text } fitNotes modelInfo revision products supplierId } }',
      z.object({ sizeChart: chartSchema.nullable() }),
      { id },
    )
  ).sizeChart

export interface SizeChartInput {
  name: string
  unit: 'cm' | 'in'
  systems: string[]
  measurements: string[]
  rows: { size: string; values: string[] }[]
  howToMeasure: { measurement: string; text: string }[]
  fitNotes: string | null
  modelInfo: string | null
}

/** A new chart (no id), or the next revision of one. */
export const saveSizeChart = async (id: string | null, revision: number | null, input: SizeChartInput): Promise<{ id: string; revision: number }> =>
  (
    await query(
      'mutation S($id: ID, $r: Int, $input: SizeChartInput!) { saveSizeChart(id: $id, revision: $r, input: $input) { id revision } }',
      z.object({ saveSizeChart: z.object({ id: z.string(), revision: z.number().int() }) }),
      { id, r: revision, input },
    )
  ).saveSizeChart

/** Answers how many products lost it (R10). */
export const deleteSizeChart = async (id: string): Promise<number> =>
  (await query('mutation D($id: ID!) { deleteSizeChart(id: $id) }', z.object({ deleteSizeChart: z.number().int() }), { id })).deleteSizeChart
