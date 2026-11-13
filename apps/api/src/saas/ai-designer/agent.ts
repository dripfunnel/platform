import { z } from 'zod'
import type { AiImage, AiProvider, CanonicalMessage, CanonicalTool, CanonicalToolCall } from '#integrations/ai/index'
import type { FileChange, GateProblem } from '#integrations/sandbox/index'
import { applyEdits, type FileEdit } from '#saas/studio/index'

// The studio's agent (storefront AI-STUDIO §4 step 2, "The agent"): the model works on a copy of the theme held here, one
// file at a time, and checks it with the sandbox before it finishes. Every tool runs in the Worker; the model runs nothing.

export const agentLimits = { calls: 40, inputTokens: 1_500_000, wallMs: 170_000, screenshots: 3 } as const
/** Tools stop this long before the clock ends, so the last turn (up to the model's 180 s) ends near it, not far past. */
export const lastTurnMs = 90_000
export type AgentLimits = { calls: number; inputTokens: number; wallMs: number; screenshots: number }

/** What the agent may ask of the runner: the sandbox's pre-check, and a picture of a page with its working copy. */
export type AgentHooks = {
  check: (changes: FileChange[]) => Promise<GateProblem[]>
  screenshot?: ((changes: FileChange[], page: string) => Promise<AiImage[] | null>) | undefined
  /** The step the progress feed shows; never a file's name or content (AI-STUDIO §4 "Live progress"). */
  step?: ((step: 'reading' | 'editing' | 'checking') => void) | undefined
  /** The model's own words between tool calls, shown as its thought when they are plain. */
  thought?: ((text: string) => void) | undefined
}

/** A tool the caller adds beside the agent's own (photos, store lookups); it answers in text and may show images. */
export type SideTool = { defs: readonly CanonicalTool[]; run: (call: CanonicalToolCall) => Promise<{ content: string; isError: boolean; images: AiImage[] } | null> }

const finishSchema = z.strictObject({ reply: z.string().min(1).max(2000), changed: z.array(z.string().max(80)).max(5), page: z.string().max(200).nullable() })
export type Finished = z.infer<typeof finishSchema>

const maxRead = 100 * 1024
const pathArg = { path: { type: 'string', maxLength: 512 } } as const

const agentToolDefs: readonly CanonicalTool[] = [
  { name: 'list_files', description: "The theme's files with their sizes in bytes, as they are in your working copy now.", parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_file', description: 'One file of your working copy, whole. Read a file before you edit it.', parameters: { type: 'object', properties: pathArg, required: ['path'], additionalProperties: false } },
  {
    name: 'edit_file',
    description: 'Change a file with exact search-and-replace edits, applied in order. Each search must appear exactly once in the file as it is now: copy it exactly, spaces and line breaks included, with just enough around it to be unique.',
    parameters: { type: 'object', properties: { ...pathArg, edits: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { search: { type: 'string' }, replace: { type: 'string' } }, required: ['search', 'replace'], additionalProperties: false } } }, required: ['path', 'edits'], additionalProperties: false },
  },
  { name: 'write_file', description: 'Write a whole file: a new one, or one you replace entirely. At most 100 KB.', parameters: { type: 'object', properties: { ...pathArg, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
  { name: 'delete_file', description: 'Delete a file of the theme.', parameters: { type: 'object', properties: pathArg, required: ['path'], additionalProperties: false } },
  { name: 'check', description: 'Run the validator and the type check on your working copy, as the gate will. Call it after your edits and fix every problem it names before you finish.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'finish',
    description: 'End the change once check passes. reply: one or two short first-person sentences in plain words on what you changed; changed: 2 to 5 short labels; page: the page to show, or null.',
    parameters: { type: 'object', properties: { reply: { type: 'string' }, changed: { type: 'array', items: { type: 'string' }, maxItems: 5 }, page: { type: ['string', 'null'] } }, required: ['reply', 'changed', 'page'], additionalProperties: false },
  },
]

const screenshotDef: CanonicalTool = {
  name: 'screenshot_page',
  description:
    "A picture of one page (home, product, collection, about, or a custom page's path) with your working copy, rendered without the shop's data: product lists and the shop's photos show empty there, so judge the layout, colours, type and spacing, never the empty grids.",
  parameters: { type: 'object', properties: { page: { type: 'string', maxLength: 200 } }, required: ['page'], additionalProperties: false },
}

/** How the agent works, after the design rules (which end where the one-shot answer's format would begin). */
export const agentRules = `
How you work
- You have tools and a working copy of the theme. Work like an engineer: list_files, read the files you need, change them
  with edit_file (or write_file for a new file), call check, fix every problem it names, check again, then call finish.
  Change nothing you don't need to. Words you write to the merchant between tool calls are shown as you go: keep them to
  one short plain sentence, never a path or code.
- Before your first edit, say in one short sentence which part of which page you will change and how.
- When the request is answered with questions or a plan (see "Questions and a plan"), call no tool: answer with only that
  JSON object.
- Never finish while check names a problem. You have at most a few dozen tool calls: read only what you need.`

const pathOf = (args: Record<string, unknown>): string | null => (typeof args['path'] === 'string' && args['path'].trim() !== '' ? args['path'].trim().replace(/^\.?\/+/, '') : null)

const argsOf = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const problemsText = (problems: readonly GateProblem[]) =>
  problems
    .slice(0, 30)
    .map((p) => `- ${p.file ?? ''}${p.line ? `:${p.line}` : ''} ${p.rule}: ${p.message}`)
    .join('\n')

/** The working copy's difference from where it started, as the sandbox takes it. */
export const changesOf = (start: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>): FileChange[] => [
  ...[...now].filter(([path, content]) => start.get(path) !== content).map(([path, content]) => ({ path, content })),
  ...[...start.keys()].filter((path) => !now.has(path)).map((path) => ({ path, content: null })),
]

/** The difference as the runner takes an answer: whole files, and the files to delete. */
const filesOf = (changes: readonly FileChange[]): FileEdit[] => changes.map((c) => (c.content === null ? { path: c.path, delete: true as const } : { path: c.path, content: c.content }))

type Spent = { tokensIn: number; tokensOut: number; tokensCached: number; costAmount: number; costCurrency: string; model: string }

/** Input as it is billed: a cached token costs about a tenth of a fresh one (Anthropic's cache read), so the budget counts it so. */
export const billedInput = (s: { tokensIn: number; tokensCached: number }) => s.tokensIn - s.tokensCached + Math.ceil(s.tokensCached / 10)

/** The conversation with one cache marker, on its newest tool result, so each turn reads the turns before it from the cache. */
const rollingCache = (messages: readonly CanonicalMessage[]): CanonicalMessage[] => {
  const at = messages.findLastIndex((m) => m.role === 'tool')
  return at < 0 ? [...messages] : messages.map((m, i) => (i === at ? { ...m, content: m.content.map((p, j) => (j === m.content.length - 1 && p.type === 'tool_result' ? { ...p, cache: true } : p)) } : m))
}

export type AgentRun = {
  provider: AiProvider
  system: string
  opening: CanonicalMessage
  /** The theme the change starts from, and the files a repair carries over from the answer that failed. */
  start: ReadonlyMap<string, string>
  carried: readonly FileEdit[]
  hooks: AgentHooks
  side: SideTool | null
  limits?: Partial<AgentLimits>
  signal?: AbortSignal | undefined
  now?: () => number
}

export type AgentResult = Spent & { files: FileEdit[]; finished: Finished | null; text: string }

/** The agent's turns until it finishes, answers in words, or a limit ends it; the files are whatever its copy holds then. */
export const runAgent = async (run: AgentRun): Promise<AgentResult> => {
  const limits: AgentLimits = { ...agentLimits, ...run.limits }
  const now = run.now ?? Date.now
  const startedAt = now()
  const base = new Map(run.start)
  const carried = applyEdits(base, run.carried)
  const working = new Map(carried.ok ? carried.after : base)
  const spent: Spent = { tokensIn: 0, tokensOut: 0, tokensCached: 0, costAmount: 0, costCurrency: 'USD', model: '' }
  const offered = [...agentToolDefs, ...(run.hooks.screenshot ? [screenshotDef] : []), ...(run.side?.defs ?? [])]
  const messages: CanonicalMessage[] = [run.opening]
  let calls = 0
  let shots = 0
  let nudged = false
  let warned = false
  let lastWords = ''
  let lastCheck: GateProblem[] | null = null
  const result = (finished: Finished | null, text: string): AgentResult => ({ ...spent, files: filesOf(changesOf(base, working)), finished, text })

  for (;;) {
    run.signal?.throwIfAborted()
    const out = calls >= limits.calls || billedInput(spent) >= limits.inputTokens || now() - startedAt >= Math.max(limits.wallMs - lastTurnMs, 0)
    // Out of calls, tokens or time: one last turn without tools, told to say what it changed, so a kept change has a reply.
    if (out) messages.push({ role: 'user', content: [{ type: 'text', text: 'You are out of tool calls or time. In one or two short plain sentences, say what you changed.' }] })
    const turn = await run.provider.converse?.({ system: run.system, cacheSystem: true, messages: rollingCache(messages), tools: offered, toolChoice: out ? 'none' : 'auto', ...(run.signal ? { signal: run.signal } : {}) })
    if (!turn) throw new Error('runAgent: no converse')
    spent.tokensIn += turn.tokensIn
    spent.tokensOut += turn.tokensOut
    spent.tokensCached += turn.tokensCached ?? 0
    spent.costAmount += turn.costAmount
    spent.costCurrency = turn.costCurrency
    spent.model = turn.model
    if (turn.text.trim() !== '') {
      lastWords = turn.text.trim()
      run.hooks.thought?.(turn.text)
    }
    if (!turn.wantsTools || out) {
      // Ended in words: once, it is asked to finish; after that, or past a limit, its words and its copy stand as they are.
      const changed = changesOf(base, working).length > 0
      if (!out && !nudged && changed) {
        nudged = true
        messages.push({ role: 'assistant', content: [{ type: 'text', text: turn.text || '…' }] }, { role: 'user', content: [{ type: 'text', text: 'Call check, fix what it names, then call finish.' }] })
        continue
      }
      return result(null, turn.text.trim() || lastWords)
    }
    messages.push({ role: 'assistant', content: [...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []), ...turn.toolCalls.map((c) => ({ type: 'tool_call' as const, id: c.id, name: c.name, arguments: c.arguments }))] })
    const results: { type: 'tool_result'; callId: string; content: string; isError: boolean }[] = []
    const shown: AiImage[] = []
    let finished: Finished | null = null
    for (const call of turn.toolCalls) {
      run.signal?.throwIfAborted()
      calls += 1
      const args = argsOf(call.arguments)
      const path = pathOf(args)
      const answer = (content: string, isError = false) => results.push({ type: 'tool_result', callId: call.id, content, isError })
      if (calls > limits.calls) {
        answer('The limit of tool calls is reached: call finish now.', true)
        continue
      }
      switch (call.name) {
        case 'list_files':
          run.hooks.step?.('reading')
          answer([...working].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, c]) => `${p} ${new TextEncoder().encode(c).byteLength}`).join('\n'))
          break
        case 'read_file': {
          run.hooks.step?.('reading')
          const text = path === null ? undefined : working.get(path)
          if (text === undefined) answer(`There is no file ${JSON.stringify(path ?? '')}. Call list_files.`, true)
          else answer(text.length > maxRead ? `${text.slice(0, maxRead)}\n… (cut at 100 KB)` : text)
          break
        }
        case 'edit_file': {
          run.hooks.step?.('editing')
          const edits = Array.isArray(args['edits']) ? args['edits'].filter((e): e is { search: string; replace: string } => typeof e === 'object' && e !== null && typeof (e as Record<string, unknown>)['search'] === 'string' && typeof (e as Record<string, unknown>)['replace'] === 'string') : []
          if (path === null || edits.length === 0) {
            answer('edit_file takes a path and at least one edit of a search and its replace.', true)
            break
          }
          const applied = applyEdits(working, [{ path, edits }])
          if (!applied.ok) answer(`Nothing of this edit was applied:\n${problemsText(applied.problems)}\nRead the file again and copy the search exactly.`, true)
          else {
            for (const [p, c] of applied.after) working.set(p, c)
            lastCheck = null
            answer('Done.')
          }
          break
        }
        case 'write_file': {
          run.hooks.step?.('editing')
          const content = args['content']
          if (path === null || typeof content !== 'string') answer('write_file takes a path and the whole content.', true)
          else if (content.length > maxRead) answer('A file holds at most 100 KB: split it into components.', true)
          else {
            working.set(path, content)
            lastCheck = null
            answer('Written.')
          }
          break
        }
        case 'delete_file':
          run.hooks.step?.('editing')
          if (path === null || !working.has(path)) answer(`There is no file ${JSON.stringify(path ?? '')}.`, true)
          else {
            working.delete(path)
            lastCheck = null
            answer('Deleted.')
          }
          break
        case 'check': {
          run.hooks.step?.('checking')
          const changes = changesOf(base, working)
          if (changes.length === 0) {
            answer('You have changed nothing yet.')
            break
          }
          lastCheck = await run.hooks.check(changes)
          answer(lastCheck.length === 0 ? 'No problems: the validator and the type check pass. Call finish, or keep working.' : `Fix these, then check again:\n${problemsText(lastCheck)}`, lastCheck.length > 0)
          break
        }
        case 'screenshot_page': {
          const page = typeof args['page'] === 'string' && args['page'].trim() !== '' ? args['page'].trim() : 'home'
          shots += 1
          if (!run.hooks.screenshot || shots > limits.screenshots) {
            answer('No more pictures in this change.', true)
            break
          }
          run.hooks.step?.('checking')
          const images = await run.hooks.screenshot(changesOf(base, working), page)
          if (!images || images.length === 0) answer('That page could not be pictured now. Go on without it.', true)
          else {
            shown.push(...images)
            answer(`The picture of the ${page} page follows, top down.`)
          }
          break
        }
        case 'finish': {
          const parsed = finishSchema.safeParse({ ...args, changed: Array.isArray(args['changed']) ? args['changed'].slice(0, 5) : args['changed'] })
          if (!parsed.success) {
            answer(`finish takes reply, changed and page: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, true)
            break
          }
          if (lastCheck === null && changesOf(base, working).length > 0) {
            answer('Call check first, and fix what it names.', true)
            break
          }
          if (lastCheck !== null && lastCheck.length > 0 && !warned) {
            warned = true
            answer('check still names problems: fix them and check again before you finish.', true)
            break
          }
          finished = parsed.data
          answer('Finished.')
          break
        }
        default: {
          const found = run.side ? await run.side.run(call) : null
          if (!found) answer('That is not a tool you have, or its arguments are wrong.', true)
          else {
            shown.push(...found.images)
            answer(found.content, found.isError)
          }
        }
      }
    }
    messages.push({ role: 'tool', content: results })
    if (shown.length > 0) messages.push({ role: 'user', content: shown.map((i) => ({ type: 'image' as const, mediaType: i.mediaType, base64: i.base64 })) })
    if (finished) return result(finished, turn.text)
  }
}
