import { describe, expect, it } from 'vitest'
import type { AiProvider, AiTurn, CanonicalMessage, CanonicalTool } from '#integrations/ai/index'
import type { FileChange, GateProblem } from '#integrations/sandbox/index'
import { runAgent, type AgentHooks, type SideTool } from './agent'

const spent = { tokensIn: 100, tokensOut: 10, costAmount: 1, costCurrency: 'USD', model: 'fake' }
const call = (name: string, args: unknown, id = name) => ({ id, name, arguments: JSON.stringify(args) })
const tools = (...calls: ReturnType<typeof call>[]): AiTurn => ({ text: '', toolCalls: calls, wantsTools: true, ...spent })
const words = (text: string): AiTurn => ({ text, toolCalls: [], wantsTools: false, ...spent })

const css = 'src/theme/styles/theme.css'
const start = new Map([
  [css, ':root { --color-button: #1f6feb; }\n'],
  ['content/en/home.json', '{"title":"Hi"}\n'],
])
const problem: GateProblem = { step: 'typecheck', file: css, line: 1, rule: 'ts/2322', message: 'Wrong' }

/** A model that plays `turns` in order, and what it was sent each time. */
const scripted = (turns: AiTurn[]) => {
  const seen: { messages: CanonicalMessage[]; tools: readonly CanonicalTool[]; toolChoice: string | undefined }[] = []
  const provider: AiProvider = {
    complete: async () => ({ text: '', ...spent }),
    converse: async (c) => (seen.push({ messages: [...c.messages], tools: c.tools, toolChoice: c.toolChoice }), turns.shift() ?? words('Done.')),
  }
  return { provider, seen }
}

const run = (turns: AiTurn[], hooks: Partial<AgentHooks> = {}, extra: Partial<Parameters<typeof runAgent>[0]> = {}) => {
  const { provider, seen } = scripted(turns)
  const checked: FileChange[][] = []
  const steps: string[] = []
  const check = hooks.check ?? (async (changes: FileChange[]) => (checked.push(changes), []))
  const opening: CanonicalMessage = { role: 'user', content: [{ type: 'text', text: 'Make the buttons maroon' }] }
  return runAgent({ provider, system: 'rules', opening, start, carried: [], hooks: { ...hooks, check, step: (s) => steps.push(s) }, side: null, ...extra }).then((result) => ({ result, seen, checked, steps }))
}

const toolResults = (m: CanonicalMessage | undefined) => (m?.content ?? []).flatMap((p) => (p.type === 'tool_result' ? [p] : []))

describe('the studio agent', () => {
  it('reads, edits, checks and finishes, handing back the whole changed file and its reply', async () => {
    const { result, checked, steps } = await run([
      tools(call('list_files', {})),
      tools(call('read_file', { path: css })),
      tools(call('edit_file', { path: css, edits: [{ search: '#1f6feb', replace: '#800000' }] })),
      tools(call('check', {})),
      tools(call('finish', { reply: 'I made the buttons maroon.', changed: ['Buttons'], page: 'home' })),
    ])
    expect(result.files).toEqual([{ path: css, content: ':root { --color-button: #800000; }\n' }])
    expect(result.finished).toEqual({ reply: 'I made the buttons maroon.', changed: ['Buttons'], page: 'home' })
    expect(checked).toEqual([[{ path: css, content: ':root { --color-button: #800000; }\n' }]])
    expect(steps).toEqual(['reading', 'reading', 'editing', 'checking'])
    expect(result.tokensIn).toBe(500)
  })

  it('names the check’s problems back to the model and lets it fix them before it finishes', async () => {
    let first = true
    const { result, seen } = await run(
      [
        tools(call('edit_file', { path: css, edits: [{ search: '#1f6feb', replace: 'maroon' }] })),
        tools(call('check', {})),
        tools(call('edit_file', { path: css, edits: [{ search: 'maroon', replace: '#800000' }] }), call('check', {}, 'c2')),
        tools(call('finish', { reply: 'Done.', changed: ['Buttons'], page: null })),
      ],
      { check: async () => (first ? ((first = false), [problem]) : []) },
    )
    expect(toolResults(seen[2]?.messages.at(-1))[0]).toMatchObject({ isError: true, content: expect.stringContaining('ts/2322: Wrong') })
    expect(result.files).toEqual([{ path: css, content: ':root { --color-button: #800000; }\n' }])
  })

  it('refuses to finish a change it never checked, and an edit whose search isn’t found once, applying none of it', async () => {
    const { result, seen } = await run([
      tools(call('edit_file', { path: css, edits: [{ search: 'missing', replace: 'x' }] })),
      tools(call('write_file', { path: 'src/theme/components/New.tsx', content: 'export const New = () => null\n' })),
      tools(call('finish', { reply: 'Done.', changed: [], page: null })),
      tools(call('check', {})),
      tools(call('finish', { reply: 'Done.', changed: ['New part'], page: null })),
    ])
    expect(toolResults(seen[1]?.messages.at(-1))[0]).toMatchObject({ isError: true, content: expect.stringContaining('Nothing of this edit was applied') })
    expect(toolResults(seen[3]?.messages.at(-1))[0]).toMatchObject({ isError: true, content: 'Call check first, and fix what it names.' })
    expect(result.files).toEqual([{ path: 'src/theme/components/New.tsx', content: 'export const New = () => null\n' }])
  })

  it('refuses once to finish over problems its last check named', async () => {
    const { result, seen } = await run(
      [tools(call('edit_file', { path: css, edits: [{ search: '#1f6feb', replace: 'maroon' }] })), tools(call('check', {})), tools(call('finish', { reply: 'Done.', changed: [], page: null })), tools(call('finish', { reply: 'Done anyway.', changed: [], page: null }))],
      { check: async () => [problem] },
    )
    expect(toolResults(seen[3]?.messages.at(-1))[0]).toMatchObject({ isError: true, content: expect.stringContaining('check still names problems') })
    expect(result.finished?.reply).toBe('Done anyway.')
  })

  it('marks only the newest tool result for the cache, so each turn reads the ones before it from the cache', async () => {
    const { seen } = await run([tools(call('list_files', {})), tools(call('read_file', { path: css })), words('Nothing to change.')])
    const marked = (seen[2]?.messages ?? []).flatMap((m) => m.content).filter((p) => p.type === 'tool_result' && p.cache)
    expect(marked).toHaveLength(1)
    expect(seen[2]?.messages.at(-1)?.content.at(-1)).toMatchObject({ type: 'tool_result', cache: true })
  })

  it('out of calls with a change made, asks for what it changed and answers with its last words when the turn has none', async () => {
    const edit = tools(call('edit_file', { path: css, edits: [{ search: '#1f6feb', replace: '#800000' }] }))
    const { result, seen } = await run([{ ...edit, text: 'Making the buttons maroon.' }, words('')], {}, { limits: { calls: 1 } })
    expect(JSON.stringify(seen[1]?.messages.at(-1))).toContain('say what you changed')
    expect(result.text).toBe('Making the buttons maroon.')
    expect(result.files).toHaveLength(1)
  })

  it('stops offering tools a last turn before its clock ends', async () => {
    let clock = 0
    const { seen } = await run([tools(call('list_files', {})), words('Out of time.')], {}, { limits: { wallMs: 100_000 }, now: () => (clock += 6_000) })
    expect(seen.map((s) => s.toolChoice)).toEqual(['auto', 'none'])
  })

  it('asks once to finish when it ends in words with a change made, then stands on its words', async () => {
    const { result, seen } = await run([tools(call('delete_file', { path: 'content/en/home.json' })), words('I removed it.'), words('Really done.')])
    expect(seen).toHaveLength(3)
    expect(result.finished).toBeNull()
    expect(result.text).toBe('Really done.')
    expect(result.files).toEqual([{ path: 'content/en/home.json', delete: true }])
  })

  it('stops offering tools once its calls run out, and keeps what its copy holds', async () => {
    const edit = tools(call('edit_file', { path: css, edits: [{ search: '#1f6feb', replace: '#800000' }] }))
    const { result, seen } = await run([edit, tools(call('list_files', {})), words('Out of calls.')], {}, { limits: { calls: 2 } })
    expect(seen.map((s) => s.toolChoice)).toEqual(['auto', 'auto', 'none'])
    expect(result.files).toEqual([{ path: css, content: ':root { --color-button: #800000; }\n' }])
  })

  it('starts a repair from the change that failed, so it fixes it rather than redoing it', async () => {
    const carried = [{ path: css, content: ':root { --color-button: maroon; }\n' }]
    const { result } = await run([tools(call('edit_file', { path: css, edits: [{ search: 'maroon', replace: '#800000' }] })), tools(call('check', {})), tools(call('finish', { reply: 'Fixed.', changed: ['Buttons'], page: null }))], {}, { carried })
    expect(result.files).toEqual([{ path: css, content: ':root { --color-button: #800000; }\n' }])
  })

  it('passes other tools to the side tool and pictures a page through the hook, showing the images after the results', async () => {
    const side: SideTool = { defs: [{ name: 'store_photos', description: 'x', parameters: { type: 'object' } }], run: async (c) => (c.name === 'store_photos' ? { content: '[]', isError: false, images: [] } : null) }
    const image = { mediaType: 'image/jpeg' as const, base64: 'AA==' }
    const { seen } = await run([tools(call('store_photos', {}), call('screenshot_page', { page: 'home' }, 's')), words('Nothing to change.')], { screenshot: async () => [image] }, { side })
    expect(seen[0]?.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['read_file', 'check', 'finish', 'screenshot_page', 'store_photos']))
    expect(toolResults(seen[1]?.messages.at(-2)).map((r) => r.isError)).toEqual([false, false])
    expect(seen[1]?.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', base64: 'AA==' }] })
  })
})
