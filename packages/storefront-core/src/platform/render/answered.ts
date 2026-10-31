import { recordedShopClient, type RecordedAnswer } from '../api/recorded'
import type { ShopClient } from '../api/client'
import type { PrefilledData } from './data'

// The live build's render from a catalogue snapshot (storefront ARCHITECTURE §4.2): each page asks, the recorded
// answers are given, and the page renders again until it asks nothing new.

/** `answers`: what the page was rendered with, by question, for its hydration. `unexpected`: codes of answers core couldn't use. */
export type AnsweredPage = { html: string; answers: Record<string, unknown>; unexpected: string[] }

// A question can wait on another's answer (`/collections/all/` lists every product once `all` is known not to be a
// collection), so a page is rendered at most this many times.
const maxPasses = 4

type Build = { client: ShopClient; answers: Map<string, unknown>; failed: Set<string> }

// An answer is the same on every page of one catalogue, so each question is answered (or refused) once per build.
const builds = new WeakMap<readonly RecordedAnswer[], Build>()
const buildOf = (recorded: readonly RecordedAnswer[]): Build => {
  let found = builds.get(recorded)
  if (!found) builds.set(recorded, (found = { client: recordedShopClient(recorded), answers: new Map(), failed: new Set() }))
  return found
}

const codeOf = (error: unknown) => (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN')

export const answeredRender = async (recorded: readonly RecordedAnswer[], render: (client: ShopClient, prefilled: PrefilledData) => string): Promise<AnsweredPage> => {
  const build = buildOf(recorded)
  // The page's own answers: only those it asks for, taken from the build's.
  const own = new Map<string, unknown>()
  const answers = {
    has: (key: string) => {
      if (!own.has(key) && build.answers.has(key)) own.set(key, build.answers.get(key))
      return own.has(key)
    },
    get: (key: string) => (answers.has(key) ? own.get(key) : undefined),
  }
  const unexpected: string[] = []
  for (let pass = 1; ; pass += 1) {
    const asked = new Map<string, (client: ShopClient) => Promise<unknown>>()
    const html = render(build.client, { answers, ask: (key, load) => void (build.failed.has(key) || asked.set(key, load)) })
    if (asked.size === 0 || pass === maxPasses) return { html, answers: Object.fromEntries(own), unexpected }
    await Promise.all(
      [...asked].map(async ([key, load]) => {
        try {
          build.answers.set(key, JSON.parse(JSON.stringify(await load(build.client))) as unknown)
        } catch (error) {
          build.failed.add(key)
          if (codeOf(error) !== 'NOT_RECORDED') unexpected.push(codeOf(error))
        }
      }),
    )
  }
}
