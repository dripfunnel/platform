import { describe, expect, it } from 'vitest'
import type { AiProvider } from '#integrations/ai/index'
import { answersOf, buildOrder, flowOf, pageRequests, planReply, planRules, type DesignPlan, type PlanFlow } from './plan'

const plan: DesignPlan = {
  header: 'logo and a short menu',
  footer: 'shipping and contact',
  pages: [
    { page: 'lookbook', title: 'Lookbook', sections: ['large photos'] },
    { page: 'about', title: 'About', sections: ['the story'] },
    { page: 'product', title: 'Product', sections: ['large gallery', 'zoom'] },
    { page: 'home', title: 'Home', sections: ['hero with silk sarees', '3 collection tiles'] },
  ],
}
const flow: PlanFlow = { kind: 'plan', state: 'open', request: 'Make my store look premium', answers: [{ question: 'Mood?', answer: 'Calm and premium' }, { question: 'Lead with?', answer: null }], plan, changes: 0 }

describe('the build’s pages (#1243)', () => {
  it('builds home first, then product, collection and about, then the plan’s own pages in its order', () => {
    expect(buildOrder(plan).map((p) => p.page)).toEqual(['home', 'product', 'about', 'lookbook'])
    expect(buildOrder({ ...plan, pages: [...plan.pages, { page: 'home', title: 'Again', sections: ['x'] }] }).filter((p) => p.page === 'home')).toHaveLength(1)
  })

  it('asks each page with the plan and the answers, the header and footer with home only', () => {
    const [home, product] = pageRequests(flow)
    expect(home?.request).toContain('Build page 1 of 4')
    expect(home?.request).toContain('Build the header too: logo and a short menu.')
    expect(home?.request).toContain('Mood? Calm and premium')
    expect(home?.request).not.toContain('Lead with?')
    expect(product?.request).toContain('Keep the header, the footer and the pages already built as they are.')
    expect(product?.request).toContain('The merchant first asked: Make my store look premium')
    expect(product).toMatchObject({ page: 'product', title: 'Product' })
  })
})

describe('the answers and the stored flow', () => {
  const questions = [
    { text: 'Mood?', options: ['Calm', 'Bold'] },
    { text: 'Lead with?', options: ['Best sellers', 'New'] },
  ]

  it('takes an option, words of the merchant’s own, or none for each question; refuses too many or too long', () => {
    expect(answersOf(questions, ['Calm', ' my own words '])).toEqual([
      { question: 'Mood?', answer: 'Calm' },
      { question: 'Lead with?', answer: 'my own words' },
    ])
    expect(answersOf(questions, [])).toEqual([
      { question: 'Mood?', answer: null },
      { question: 'Lead with?', answer: null },
    ])
    expect(answersOf(questions, ['a', 'b', 'c'])).toBeNull()
    expect(answersOf(questions, ['x'.repeat(201)])).toBeNull()
  })

  it('reads a message’s detail with a strict schema: an unknown field or state is no flow', () => {
    expect(flowOf(flow)).toEqual(flow)
    expect(flowOf({ ...flow, extra: 1 })).toBeNull()
    expect(flowOf({ ...flow, state: 'done' })).toBeNull()
    expect(flowOf(null)).toBeNull()
  })
})

describe('the plan call', () => {
  const reply = JSON.stringify({ plan, reply: 'Here is my plan.' })
  const ask = async (text: string, change: string | null = null) => {
    const calls: { system: string; context: readonly string[] | undefined; text: string }[] = []
    const provider: AiProvider = { complete: async (c) => (calls.push({ system: c.system, context: c.context, text: c.text }), { text, model: 'm', tokensIn: 1, tokensOut: 1, costAmount: 1, costCurrency: 'USD' }) }
    const made = await planReply(provider, { store: { name: 'Silk House', languages: ['en'] }, summary: null }, { request: flow.request, answers: flow.answers, previous: change ? plan : null, change })
    return { made, calls }
  }

  it('sends the stable rules and shop first and the request, answers and change after them', async () => {
    const { made, calls } = await ask(reply, 'add a lookbook page')
    expect(made.plan).toEqual(plan)
    expect(calls[0]?.system).toBe(planRules)
    expect(calls[0]?.context?.[0]).toContain('Silk House')
    expect(calls[0]?.context?.[0]).not.toContain('premium')
    expect(calls[0]?.text).toContain('Change the plan as they now ask, keeping the rest: add a lookbook page')
    expect(calls[0]?.text).toContain(JSON.stringify(plan))
  })

  it('reads a plan of more than six pages, or an unknown field, as none', async () => {
    const seven = { ...plan, pages: Array.from({ length: 7 }, (_, i) => ({ page: `p${i}`, title: `P${i}`, sections: ['x'] })) }
    expect((await ask(JSON.stringify({ plan: seven, reply: 'x' }))).made.plan).toBeNull()
    expect((await ask(JSON.stringify({ plan, reply: 'x', extra: 1 }))).made.plan).toBeNull()
  })
})
