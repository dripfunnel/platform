import ts from 'typescript'

// The fast gate's lanes (storefront ARCHITECTURE §6.2, #1240), chosen here from the diff and never by the model: what
// a change can't have broken isn't typechecked again. The validator, the bundle and the byte budgets run in every lane.

/** `css`: only CSS files. `class`: besides CSS, only class strings in .tsx files. `full`: anything else. */
export type Lane = 'css' | 'class' | 'full'

const isCss = (path: string) => path.endsWith('.css')
const isTsx = (path: string) => path.endsWith('.tsx')

const clsxNames = (sf: ts.SourceFile): Set<string> => {
  const names = new Set<string>()
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== 'clsx') continue
    const clause = s.importClause
    if (clause?.name) names.add(clause.name.text)
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const el of clause.namedBindings.elements) names.add(el.name.text)
  }
  return names
}

// Narrower than the validator's class positions (guard's inClassPosition): only where any string types the same. A
// component's className may take a union of literals, and `as` or `satisfies` may hold a literal to a type.
const intrinsicClassName = (node: ts.Node): boolean => {
  if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name) || node.name.text !== 'className') return false
  const tag = node.parent.parent.tagName
  return ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)
}

const inClassString = (node: ts.Node, clsx: ReadonlySet<string>): boolean => {
  let at: ts.Node = node
  for (;;) {
    const parent = at.parent
    if (intrinsicClassName(parent)) return true
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && clsx.has(parent.expression.text)) return parent.expression !== at
    const passes =
      ts.isJsxExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isArrayLiteralExpression(parent) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== at) ||
      (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === at)
    if (!passes) return false
    at = parent
  }
}

/** The file's text with every class string emptied, so two versions are equal exactly when only class strings differ. */
const masked = (path: string, text: string): string => {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const clsx = clsxNames(sf)
  const spans: [number, number][] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateTail(node)) {
      if (inClassString(node, clsx)) spans.push([node.getStart(sf) + 1, node.end - 1])
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      if (inClassString(node, clsx)) spans.push([node.getStart(sf) + 1, node.end - 2])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  let out = ''
  let from = 0
  for (const [start, end] of spans) {
    out += text.slice(from, start)
    from = end
  }
  return out + text.slice(from)
}

/** The lane for `files` written over `before`, the theme as it is; an empty change takes the full gate, as before. */
export const laneOf = (before: ReadonlyMap<string, string>, files: readonly { path: string; content: string | null }[]): Lane => {
  if (files.length === 0) return 'full'
  if (files.every((f) => isCss(f.path))) return 'css'
  const classOnly = files.every((f) => {
    if (isCss(f.path)) return true
    const was = before.get(f.path)
    return isTsx(f.path) && f.content !== null && was !== undefined && masked(f.path, was) === masked(f.path, f.content)
  })
  return classOnly ? 'class' : 'full'
}
