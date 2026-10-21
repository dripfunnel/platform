import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { ClientBundle } from './bundle'
import type { GateProblem } from './problems'

// Storefront ARCHITECTURE §9's byte budgets, over the theme's own chunks: what a change can move. A theme can't import
// lazily (§3.4), so every chunk loads on the first page; core's runtime is the publish gate's to count (AI-STUDIO §9).
export const budgets = { firstLoadJsGzip: 90 * 1024, cssGzip: 50 * 1024 } as const

const gzipped = async (file: string) => gzipSync(await readFile(file)).byteLength

export type Weight = { jsGzip: number; cssGzip: number }

export const weigh = async (out: string, bundle: ClientBundle): Promise<Weight> => {
  let jsGzip = 0
  let cssGzip = 0
  for (const f of bundle.files) {
    if (f.path.endsWith('.js')) jsGzip += await gzipped(join(out, f.path))
    if (f.path.endsWith('.css')) cssGzip += await gzipped(join(out, f.path))
  }
  return { jsGzip, cssGzip }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

export const overBudget = (w: Weight): GateProblem[] => [
  ...(w.jsGzip > budgets.firstLoadJsGzip
    ? [{ step: 'budget' as const, file: null, line: null, rule: 'budget/js', message: `The page loads ${kb(w.jsGzip)} of JavaScript gzipped, over the ${kb(budgets.firstLoadJsGzip)} budget. Make the theme's components smaller or move work to server components.` }]
    : []),
  ...(w.cssGzip > budgets.cssGzip
    ? [{ step: 'budget' as const, file: null, line: null, rule: 'budget/css', message: `The theme's CSS is ${kb(w.cssGzip)} gzipped, over the ${kb(budgets.cssGzip)} budget. Remove unused rules or share classes.` }]
    : []),
]
