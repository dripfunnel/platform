import ts from 'typescript'

export type JsonRead =
  | { ok: true; value: unknown; lineOf: (path: readonly string[]) => number | null }
  | { ok: false; line: number; message: string }

// Names that reach the code behind every object when a reader looks a key up.
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])

const lineAt = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

const keyText = (p: ts.ObjectLiteralElementLike) => (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) ? p.name.text : undefined)

/** A key written twice or one that names an object's internals, which JSON.parse would let through. */
const badKey = (sf: ts.SourceFile, node: ts.Expression): { line: number; message: string } | undefined => {
  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) {
      const found = badKey(sf, el)
      if (found) return found
    }
    return undefined
  }
  if (!ts.isObjectLiteralExpression(node)) return undefined
  const seen = new Set<string>()
  for (const p of node.properties) {
    const key = keyText(p)
    if (key === undefined || !ts.isPropertyAssignment(p)) continue
    if (seen.has(key)) return { line: lineAt(sf, p), message: `"${key}" is written twice.` }
    if (unsafeKeys.has(key)) return { line: lineAt(sf, p), message: `"${key}" can't be used as a key.` }
    seen.add(key)
    const found = badKey(sf, p.initializer)
    if (found) return found
  }
  return undefined
}

// Node names the line or the offset in its message; TypeScript's more lenient reader finds the rest.
const errorLine = (file: string, text: string, message: string): number => {
  const line = /\(line (\d+) column \d+\)$/.exec(message)?.[1]
  if (line !== undefined) return Number(line)
  const offset = /at position (\d+)/.exec(message)?.[1]
  if (offset !== undefined) return text.slice(0, Number(offset)).split('\n').length
  const { error } = ts.parseConfigFileTextToJson(file, text)
  return error?.file && error.start !== undefined ? error.file.getLineAndCharacterOfPosition(error.start).line + 1 : 1
}

/** Reads a JSON file strictly (no comments, trailing commas, repeated or unsafe keys), with the line of any value in it. */
export const readJson = (file: string, text: string): JsonRead => {
  let value: unknown
  let sf: ts.JsonSourceFile
  let bad: { line: number; message: string } | undefined
  try {
    sf = ts.parseJsonText(file, text)
    value = JSON.parse(text)
    const root = sf.statements[0]?.expression
    bad = root && badKey(sf, root)
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, line: 1, message: 'it nests too deeply.' }
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, line: errorLine(file, text, error.message), message: error.message }
  }
  const root: ts.Expression | undefined = sf.statements[0]?.expression
  if (bad) return { ok: false, line: bad.line, message: bad.message }
  const lineOf = (path: readonly string[]): number | null => {
    let node = root
    for (const key of path) {
      if (!node || !ts.isObjectLiteralExpression(node)) return null
      const found = node.properties.find((p) => keyText(p) === key)
      node = found && ts.isPropertyAssignment(found) ? found.initializer : undefined
    }
    return node ? lineAt(sf, node.parent && ts.isPropertyAssignment(node.parent) ? node.parent : node) : null
  }
  return { ok: true, value, lineOf }
}
