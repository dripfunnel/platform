import { z } from 'zod'
import type { AiProvider } from '#integrations/ai/index'
import type { BuildPage } from '#saas/studio/index'
import type { StoreSummary } from './summary'

// A vague request's quick questions, its plan and the build page by page (storefront AI-STUDIO §4 "A plan", #1243): the
// model's answers are data read with strict schemas, and every message's detail is read back with the same ones.

export const maxQuestions = 3
export const maxPlanPages = 6
/** "Changes asked in words" to one plan, inside its one prompt unit; past it a new request takes its own. */
export const maxPlanChanges = 3
/** Builds of one plan that built no page (each asked the model), inside its one prompt unit; past it a new request takes its own. */
export const maxFailedBuilds = 2
/** A claimed flow whose request ended without moving it on (a closed tab, a Worker stopped) opens again after this: past a build's 20-minute wait. */
export const claimMs = 25 * 60_000
const maxAnswer = 200

const words = (max: number) => z.string().trim().min(1).max(max)
export const questionSchema = z.strictObject({ text: words(160), options: z.array(words(80)).min(2).max(4) })
/** The core routes a build knows, then any page of the theme's own (routes.json's custom pages, ARCHITECTURE §3.4). */
const pageKey = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)
export const planSchema = z.strictObject({
  header: words(200).nullable(),
  footer: words(200).nullable(),
  pages: z.array(z.strictObject({ page: pageKey, title: words(60), sections: z.array(words(160)).min(1).max(6) })).min(1).max(maxPlanPages),
})
export type DesignQuestion = z.infer<typeof questionSchema>
export type DesignPlan = z.infer<typeof planSchema>
export type DesignAsk = { questions: DesignQuestion[] } | { plan: DesignPlan }

export const askAnswerSchema = z.union([
  z.strictObject({ questions: z.array(questionSchema).min(1).max(maxQuestions), reply: z.string().max(2000) }),
  z.strictObject({ plan: planSchema, reply: z.string().max(2000) }),
])

const request = z.string().max(2000)
/** When a request moved the flow on to work on it; null once given back. */
const claimedAt = z.iso.datetime().nullable().optional()
const answers = z.array(z.strictObject({ question: words(160), answer: z.string().max(maxAnswer).nullable() })).max(maxQuestions)
/** design_message.detail of each kind; `state` moves on in one statement (moveFlow), so a flow is answered or built once. */
export const flowSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('questions'), state: z.enum(['open', 'answered', 'skipped']), request, questions: z.array(questionSchema).max(maxQuestions), answers, claimedAt }),
  z.strictObject({ kind: z.literal('plan'), state: z.enum(['open', 'replaced', 'building', 'built']), request, answers, plan: planSchema, changes: z.number().int().min(0).max(maxPlanChanges), failedBuilds: z.number().int().min(0).max(maxFailedBuilds).optional(), claimedAt }),
  z.strictObject({ kind: z.literal('build'), pages: z.array(z.strictObject({ page: pageKey, title: words(60), outcome: z.enum(['changed', 'unchanged', 'refused', 'failed', 'left']) })).max(maxPlanPages), stopped: z.boolean() }),
])
export type Flow = z.infer<typeof flowSchema>
export type QuestionsFlow = Extract<Flow, { kind: 'questions' }>
export type PlanFlow = Extract<Flow, { kind: 'plan' }>
export type BuildFlow = Extract<Flow, { kind: 'build' }>

/**
 * Whether the newest questions or plan can be answered, changed or built: open, or claimed by a request that ended without
 * moving it on over `claimMs` ago. A built plan never opens again.
 */
export const isClaimable = (flow: QuestionsFlow | PlanFlow, at: Date): boolean => {
  if (flow.state === 'open') return true
  if (flow.state === 'built' || !flow.claimedAt) return false
  return at.getTime() - Date.parse(flow.claimedAt) > claimMs
}

export const flowOf = (detail: unknown): Flow | null => {
  const read = flowSchema.safeParse(detail)
  return read.success ? read.data : null
}

/** Each answer: one of the question's options, words of the merchant's own ("Something else"), or none; null for bad input. */
export const answersOf = (questions: readonly DesignQuestion[], given: readonly string[]): QuestionsFlow['answers'] | null => {
  if (given.length > questions.length) return null
  const out: QuestionsFlow['answers'] = []
  for (const [i, q] of questions.entries()) {
    const answer = (given[i] ?? '').trim()
    if (answer.length > maxAnswer) return null
    out.push({ question: q.text, answer: answer === '' ? null : answer })
  }
  return out
}

/** Home first (with the header and footer), then product, collection and about, then the plan's own pages in its order. */
const order = ['home', 'product', 'collection', 'about']
export const buildOrder = (plan: DesignPlan): DesignPlan['pages'] => {
  const rank = (page: string) => (order.includes(page) ? order.indexOf(page) : order.length)
  const seen = new Set<string>()
  const pages = plan.pages.filter((p) => !seen.has(p.page) && seen.add(p.page))
  return pages.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.page) - rank(b.p.page) || a.i - b.i).map(({ p }) => p)
}

const answered = (flow: Pick<PlanFlow, 'answers'>) => flow.answers.filter((a) => a.answer !== null).map((a) => `- ${a.question} ${a.answer}`)

/** One page's change: the plan and the answers go in the request, after the cached prefix (ARCHITECTURE §6.2). */
export const pageRequests = (flow: PlanFlow): BuildPage[] => {
  const pages = buildOrder(flow.plan)
  const whole = pages.map((p) => `- ${p.title} (${p.page}): ${p.sections.join('; ')}`).join('\n')
  return pages.map((p, i) => ({
    page: p.page,
    title: p.title,
    request: [
      `Build page ${i + 1} of ${pages.length} of the plan the merchant agreed: the ${p.title} page (${p.page}), with ${p.sections.join('; ')}.`,
      i === 0 ? [flow.plan.header ? `Build the header too: ${flow.plan.header}.` : '', flow.plan.footer ? `Build the footer too: ${flow.plan.footer}.` : ''].filter(Boolean).join(' ') : 'Keep the header, the footer and the pages already built as they are.',
      `The whole plan:\n${whole}`,
      `The merchant first asked: ${flow.request}`,
      ...(answered(flow).length > 0 ? [`Their answers:\n${answered(flow).join('\n')}`] : []),
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 4000),
  }))
}

export const planRules = `You plan one online shop's storefront for DripFunnel before it is built. The merchant asked for a new look in a
few words; you write the plan the AI designer then builds page by page. Plan only the look and the words: the shop's
commerce (prices, stock, products, discounts, shipping, checkout) belongs to the platform.
- Plan at most ${maxPlanPages} pages: home first, then the product page, a collection page and an about page when they help,
  and any other page only when the merchant asked for it. Each page has 1 to 6 short sections in plain words, such as
  "hero with the silk best sellers" or "3 collection tiles". Describe the header and the footer in one line each.
- Decide from the shop's own data: lead with what it really sells (its best sellers, else its newest), give tiles to the
  collections it has, and mention an offer only when one is on now. Never invent products, prices, ratings or claims.
- Follow the merchant's answers; a question left unanswered is yours to decide from the shop's data.
- Page keys: home, product, collection, about, or a short lowercase name for a page of the shop's own, such as lookbook.
Answer with only one JSON object and nothing else:
{"plan":{"header":"one line","footer":"one line","pages":[{"page":"home","title":"Home","sections":["..."]}]},"reply":"one
short first-person sentence introducing the plan, in the merchant's language"}`

const planAnswerSchema = z.strictObject({ plan: planSchema, reply: z.string().max(2000) })

const readPlan = (text: string): z.infer<typeof planAnswerSchema> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = planAnswerSchema.safeParse(JSON.parse(text.slice(start, end + 1)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export type PlanAsk = { request: string; answers: PlanFlow['answers']; previous: DesignPlan | null; change: string | null }

/** The plan from the request and the answers, or a changed plan; `plan` is null when the answer had no usable shape. */
export const planReply = async (provider: AiProvider, shop: { store: { name: string; languages: string[] }; summary: StoreSummary | null }, ask: PlanAsk) => {
  const context = [`Shop: ${JSON.stringify(shop.store)}`, shop.summary ? `The shop's own data (to decide with, never to copy): ${JSON.stringify(shop.summary)}` : ''].filter((part) => part !== '').join('\n\n')
  const text = [
    `The merchant asked: ${ask.request}`,
    ...(answered(ask).length > 0 ? [`Their answers:\n${answered(ask).join('\n')}`] : ['They skipped the questions: decide from the shop’s data.']),
    ask.previous ? `Your plan so far:\n${JSON.stringify(ask.previous)}` : '',
    ask.change ? `Change the plan as they now ask, keeping the rest: ${ask.change}` : '',
  ]
    .filter((part) => part !== '')
    .join('\n\n')
  const answer = await provider.complete({ system: planRules, context: [context], text, images: [] })
  const read = readPlan(answer.text)
  return { plan: read?.plan ?? null, reply: read?.reply.trim() ?? '', model: answer.model, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut, costAmount: answer.costAmount, costCurrency: answer.costCurrency }
}
