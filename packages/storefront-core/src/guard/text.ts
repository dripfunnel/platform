import ts from 'typescript'
import { inTheme, parts } from './program.js'

/** Text a shopper could read: a letter, a digit or a symbol such as ★ or ₹, as opposed to spaces and punctuation. */
export const isVisible = (text: string): boolean => /[\p{L}\p{N}\p{S}]/u.test(text)

const nonLatin = new RegExp('[\\p{L}--\\p{Script=Latin}]', 'v')

/** Words rather than a name or a key: two words in a row, or a letter outside the Latin script (Hindi, say). */
export const looksLikeWords = (text: string): boolean => /\p{L}\s+\p{L}/u.test(text) || nonLatin.test(text)

// A link or a resource address: links go through core's <Link>, media through <Image> and <Video>.
const address = /:\/\/|^\s*\/\/|^\s*(?:javascript|data|vbscript|blob|file|mailto|tel|sms|https?|ftp|wss?):|url\s*\(|@import/i
const svgReference = /^url\(#[A-Za-z][\w-]*\)$/

export const isAddress = (text: string): boolean => address.test(text) && !svgReference.test(text.trim())

/** A literal type a shopper would read if it were rendered: visible words, or any number. */
export const isVisibleLiteral = (type: ts.Type): boolean =>
  parts(type).some((t) => (t.isStringLiteral() && isVisible(t.value)) || t.isNumberLiteral() || (t.flags & ts.TypeFlags.BigIntLiteral) !== 0)

const maxSteps = 8
const holdsText = (type: ts.Type) => parts(type).some((t) => (t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) !== 0)

const returnsOf = (fn: ts.SignatureDeclaration): ts.Expression[] => {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body]
  const found: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) found.push(node.expression)
    else if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit)
  }
  if ('body' in fn && fn.body) ts.forEachChild(fn.body, visit)
  return found
}

/** Where a theme declaration's value comes from: its initializer, a function's returns, or the list a callback walks. */
const sourcesOf = (declaration: ts.Declaration): ts.Expression[] => {
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const value = declaration.initializer
    return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? returnsOf(value) : [value]
  }
  if (ts.isFunctionDeclaration(declaration)) return returnsOf(declaration)
  if (ts.isPropertyAssignment(declaration)) return [declaration.initializer]
  if (ts.isShorthandPropertyAssignment(declaration)) return [declaration.name]
  if (ts.isBindingElement(declaration)) {
    let holder: ts.Node = declaration.parent.parent
    while (ts.isBindingElement(holder)) holder = holder.parent.parent
    const from = ts.isVariableDeclaration(holder) && holder.initializer ? [holder.initializer] : []
    return [...(declaration.initializer ? [declaration.initializer] : []), ...from]
  }
  if (ts.isParameter(declaration)) {
    const fn = declaration.parent
    const walked = ts.isCallExpression(fn.parent) && ts.isPropertyAccessExpression(fn.parent.expression) ? [fn.parent.expression.expression] : []
    return [...(declaration.initializer ? [declaration.initializer] : []), ...walked]
  }
  return []
}

/**
 * Whether a rendered expression shows text the theme wrote, followed through variables, lists, lookups, templates and
 * the theme's own functions (ARCHITECTURE §3.4 "No text in code").
 */
export const showsWrittenText = (checker: ts.TypeChecker, expr: ts.Expression, steps = 0): boolean => {
  if (steps > maxSteps) return false
  const next = (e: ts.Expression) => showsWrittenText(checker, e, steps + 1)
  const fromDeclarations = (symbol: ts.Symbol | undefined) => {
    const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return (target?.declarations ?? []).filter((d) => inTheme(d.getSourceFile().fileName)).flatMap(sourcesOf).some(next)
  }
  if (isVisibleLiteral(checker.getTypeAtLocation(expr))) return true
  if (ts.isTemplateExpression(expr)) return [expr.head, ...expr.templateSpans.map((s) => s.literal)].some((p) => isVisible(p.text)) || expr.templateSpans.some((s) => next(s.expression))
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isSpreadElement(expr)) return next(expr.expression)
  if (ts.isConditionalExpression(expr)) return next(expr.whenTrue) || next(expr.whenFalse)
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind
    const either = op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken
    return (either || (op === ts.SyntaxKind.PlusToken && holdsText(checker.getTypeAtLocation(expr)))) && (next(expr.left) || next(expr.right))
  }
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.some(next)
  if (ts.isObjectLiteralExpression(expr)) return expr.properties.some((p) => ts.isPropertyAssignment(p) && next(p.initializer))
  if (ts.isIdentifier(expr)) return fromDeclarations(checker.getSymbolAtLocation(expr))
  if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
    const symbol = checker.getSymbolAtLocation(expr)
    return symbol?.declarations?.some((d) => inTheme(d.getSourceFile().fileName)) ? fromDeclarations(symbol) : next(expr.expression)
  }
  if (ts.isCallExpression(expr) && holdsText(checker.getTypeAtLocation(expr))) {
    return ts.isPropertyAccessExpression(expr.expression) ? next(expr.expression.expression) : next(expr.expression)
  }
  return false
}
