import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// Size charts on the Store API (CATALOG-DESIGN.md R): sizes as rows, size systems and measurements as columns.

const summarySchema = z.object({ id: z.string(), name: z.string(), unit: z.enum(['cm', 'in']), products: z.number().int(), supplierId: z.string().nullable() })
export type SizeChartSummary = z.infer<typeof summarySchema>

/** Every chart the caller reads, and the cap on a store's charts, read with them. */
export const loadSizeChartList = async (client: ApiClient): Promise<{ charts: SizeChartSummary[]; limit: number }> => {
  let limit = 0
  const charts = await allPages(async (after) => {
    const page = (
      await typedQuery(client)(
        'query SizeCharts($after: String) { sizeCharts(first: 50, after: $after) { limit nodes { id name unit products supplierId } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
        z.object({ sizeCharts: z.object({ limit: z.number().int(), nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
        { after },
      )
    ).sizeCharts
    limit = page.limit
    return page
  })
  return { charts, limit }
}

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

export const loadSizeChart = async (client: ApiClient, id: string): Promise<SizeChart | null> =>
  (
    await typedQuery(client)(
      'query SizeChart($id: ID!) { sizeChart(id: $id) { id name unit systems measurements rows { size values } howToMeasure { measurement text } fitNotes modelInfo revision products supplierId } }',
      z.object({ sizeChart: chartSchema.nullable() }),
      { id },
    )
  ).sizeChart

export type SizeChartInput = {
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
export const saveSizeChart = async (client: ApiClient, id: string | null, revision: number | null, input: SizeChartInput): Promise<{ id: string; revision: number }> =>
  (
    await typedQuery(client)(
      'mutation SaveSizeChart($id: ID, $revision: Int, $input: SizeChartInput!) { saveSizeChart(id: $id, revision: $revision, input: $input) { id revision } }',
      z.object({ saveSizeChart: z.object({ id: z.string(), revision: z.number().int() }) }),
      { id, revision, input },
    )
  ).saveSizeChart

/** Answers how many products lost it (CATALOG R10). */
export const deleteSizeChart = async (client: ApiClient, id: string): Promise<number> =>
  (await typedQuery(client)('mutation DeleteSizeChart($id: ID!) { deleteSizeChart(id: $id) }', z.object({ deleteSizeChart: z.number().int() }), { id })).deleteSizeChart
