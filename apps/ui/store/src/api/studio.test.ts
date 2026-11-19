import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('Edit text’s languages', () => {
  it('are the store’s own active languages, the main one first, never the whole list a store may add', async () => {
    const storeLocale = { mainLanguage: 'en-IN', languages: [{ code: 'hi-IN', status: 'active' }, { code: 'en-IN', status: 'active' }, { code: 'en-US', status: 'removed' }] }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { storeLocale } })))
    const { loadStudioLanguages } = await import('./studio')
    expect(await loadStudioLanguages()).toEqual(['en-IN', 'hi-IN'])
  })
})

describe('a design run', () => {
  type Sent = { query: string; variables: Record<string, unknown> }
  const serve = (answer: (sent: Sent) => unknown) => {
    const sent: Sent[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Sent
      sent.push(body)
      const result = answer(body)
      if (result instanceof Error) throw result
      return new Response(JSON.stringify(result))
    })
    return sent
  }
  afterEach(() => vi.useRealTimers())

  it('starts with a run id of its own, then reads designRun until it ends, through a lost poll', async () => {
    vi.useFakeTimers()
    let polls = 0
    const sent = serve(({ query }) => {
      if (query.startsWith('mutation')) return { data: { askDesign: 'r' } }
      polls += 1
      if (polls === 2) return new TypeError('offline')
      return { data: { designRun: polls < 4 ? null : { outcome: 'changed' } } }
    })
    const { askDesign, runPollMs } = await import('./studio')
    const answer = askDesign({ text: 'Warmer', imageAssetId: null, sampleUrl: null, model: null, page: '/', device: 'desktop' })
    await vi.advanceTimersByTimeAsync(runPollMs * 4)
    expect(await answer).toBe('changed')
    const run = sent[0]?.variables['run']
    expect(run).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent.slice(1).every((s) => s.variables['r'] === run)).toBe(true)
  })

  it('answers questions and changes a plan as runs too, never one long request', async () => {
    vi.useFakeTimers()
    const sent = serve(({ query }) => (query.startsWith('mutation') ? { data: { answerDesignQuestions: 'r', changeDesignPlan: 'r' } } : { data: { designRun: { outcome: 'asked' } } }))
    const { answerDesignQuestions, changeDesignPlan, runPollMs } = await import('./studio')
    const answered = answerDesignQuestions('m1', ['Sarees'], false, null)
    const changed = changeDesignPlan('m1', 'No blog', null)
    await vi.advanceTimersByTimeAsync(runPollMs)
    expect([await answered, await changed]).toEqual(['asked', 'asked'])
    const starts = sent.filter((s) => s.query.startsWith('mutation'))
    expect(starts.map((s) => s.variables['run'])).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/), expect.stringMatching(/^[0-9a-f-]{36}$/)])
  })

  it('throws the API’s refusal, from the start or from the run, as the request did', async () => {
    serve(() => ({ data: { buildDesignPlan: null }, errors: [{ message: 'Queued', extensions: { code: 'STUDIO_QUEUED', place: 2 } }] }))
    const { buildDesignPlan } = await import('./studio')
    await expect(buildDesignPlan('m1', null)).rejects.toMatchObject({ code: 'STUDIO_QUEUED', details: { place: 2 } })

    vi.useFakeTimers()
    serve(({ query }) => (query.startsWith('mutation') ? { data: { buildDesignPlan: 'r' } } : { data: { designRun: null }, errors: [{ message: 'Used', extensions: { code: 'AI_BUDGET_REACHED' } }] }))
    const { runPollMs } = await import('./studio')
    const failed = buildDesignPlan('m1', null).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(runPollMs)
    expect(await failed).toMatchObject({ code: 'AI_BUDGET_REACHED' })
  })

  it('gives up after a build’s clock and the gate after it', async () => {
    vi.useFakeTimers()
    serve(({ query }) => (query.startsWith('mutation') ? { data: { askDesign: 'r' } } : { data: { designRun: null } }))
    const { askDesign } = await import('./studio')
    const failed = askDesign({ text: 'x', imageAssetId: null, sampleUrl: null, model: null, page: '/', device: 'desktop' }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(19 * 60_000 + 3_000)
    expect(await failed).toMatchObject({ code: 'NOT_CONNECTED' })
  })
})
