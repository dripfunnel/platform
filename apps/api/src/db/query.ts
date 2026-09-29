import type postgres from 'postgres'
import { z } from 'zod'

const binding = z.union([z.string(), z.number(), z.boolean(), z.null(), z.date()])

export const query =
  (sql: postgres.Sql) =>
  (strings: TemplateStringsArray, ...values: unknown[]) =>
    sql(strings, ...values.map((value) => binding.parse(value)))
