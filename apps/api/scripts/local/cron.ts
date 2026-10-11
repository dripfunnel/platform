import { readFileSync } from 'node:fs'

/** wrangler.jsonc's `triggers.crons`, the one list of cadences (#477). */
export const wranglerCrons = (): string[] => {
  const text = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8')
  const list = /"crons":\s*\[([^\]]*)\]/.exec(text)?.[1]
  if (list === undefined) throw new Error('wrangler.jsonc lists no triggers.crons')
  return JSON.parse(`[${list}]`) as string[]
}

// Only the forms wrangler.jsonc uses: `*`, `*/n` and a number. Cloudflare runs crons in UTC.
const fieldMatches = (spec: string, value: number): boolean => {
  if (spec === '*') return true
  if (/^\*\/\d+$/.test(spec)) return value % Number(spec.slice(2)) === 0
  if (/^\d+$/.test(spec)) return Number(spec) === value
  throw new Error(`the local cron launcher can't read "${spec}"`)
}

export const cronDue = (cron: string, at: Date): boolean => {
  const fields = cron.split(' ')
  const values = [at.getUTCMinutes(), at.getUTCHours(), at.getUTCDate(), at.getUTCMonth() + 1, at.getUTCDay()]
  if (fields.length !== values.length) throw new Error(`"${cron}" is not a five-field cron`)
  return fields.map((spec, i) => fieldMatches(spec, values[i] ?? -1)).every(Boolean)
}
