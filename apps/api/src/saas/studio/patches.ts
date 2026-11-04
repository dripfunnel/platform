import type { FileChange, GateProblem } from '#integrations/sandbox/index'
import type { FileEdit } from './model'

// The model answers with edits (storefront ARCHITECTURE §6.2); the runner turns them into the whole files the sandbox
// takes. An edit that doesn't apply is a problem for the repair loop, like the gate's, and nothing of that answer is kept.

export type Applied = { ok: true; changes: FileChange[]; after: Map<string, string> } | { ok: false; problems: GateProblem[] }

const quoted = (text: string) => JSON.stringify(text.length > 120 ? `${text.slice(0, 120)}…` : text)

const lineAt = (content: string, at: number) => content.slice(0, at).split('\n').length

const positions = (content: string, search: string): number[] => {
  const found: number[] = []
  for (let at = content.indexOf(search); at >= 0; at = content.indexOf(search, at + 1)) found.push(at)
  return found
}

const problem = (file: string, line: number | null, rule: string, message: string): GateProblem => ({ step: 'validator', file, line, rule, message })

/** Applies `files` in order to `theme`, each edit to the file as the edits before it left it; every problem is named at once. */
export const applyEdits = (theme: ReadonlyMap<string, string>, files: readonly FileEdit[]): Applied => {
  const after = new Map(theme)
  const problems: GateProblem[] = []
  for (const file of files) {
    if ('delete' in file) after.delete(file.path)
    else if ('content' in file) after.set(file.path, file.content)
    else {
      let content = after.get(file.path)
      if (content === undefined) {
        problems.push(problem(file.path, null, 'patch/missing-file', 'There is no such file to edit. Send a new file whole, with "content".'))
        continue
      }
      for (const [n, edit] of file.edits.entries()) {
        const text = content
        const found = edit.search === '' ? [] : positions(text, edit.search)
        const [at] = found
        if (found.length === 1 && at !== undefined) {
          content = text.slice(0, at) + edit.replace + text.slice(at + edit.search.length)
          continue
        }
        const which = `Edit ${n + 1} (search ${quoted(edit.search)})`
        const lines = found.map((p) => lineAt(text, p))
        if (edit.search === '') problems.push(problem(file.path, null, 'patch/empty-search', `${which} has no search text.`))
        else if (found.length === 0) problems.push(problem(file.path, null, 'patch/not-found', `${which} is not in the file. Copy the search text exactly from the theme, spaces and line breaks included.`))
        else problems.push(problem(file.path, lines[0] ?? null, 'patch/not-unique', `${which} appears ${found.length} times (lines ${lines.join(', ')}). Add lines around it so it appears once.`))
      }
      after.set(file.path, content)
    }
  }
  if (problems.length > 0) return { ok: false, problems }
  const touched = [...new Set(files.map((f) => f.path))]
  const changes = touched.flatMap((path): FileChange[] => {
    const now = after.get(path)
    if (now === theme.get(path)) return []
    return [{ path, content: now ?? null }]
  })
  return { ok: true, changes, after }
}
