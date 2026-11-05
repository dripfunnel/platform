/// <reference types="node" />
import { posix } from 'node:path'
import { find, ident, parse, walk, type CssNode } from 'css-tree'
import ts from 'typescript'
import { cssPath } from './files.js'
import { importedFrom, inTheme, parts } from './program.js'
import type { RuleId } from './rules.js'

// A product's picture comes only from its own photos (storefront ARCHITECTURE §3.4 "Pictures", #1244): inside the render of
// a product from core's hooks, no <MerchantImage> and no CSS Module class that draws a url().

type Found = { node: ts.Node; rule: RuleId; message: string }
type Draws = { kind: 'image' } | { kind: 'url'; name: string }

const rule: RuleId = 'jsx/product-image'
const own = "a product's picture comes only from its own photos, drawn with core's <Image image={product.photo} />"

/** Each CSS Module's classes that a rule drawing url() selects, directly or through a custom property holding one. */
export const urlClassesOf = (files: ReadonlyMap<string, string>): Map<string, Set<string>> => {
  const found = new Map<string, Set<string>>()
  for (const [path, text] of files) {
    if (!cssPath.test(path)) continue
    let ast: CssNode
    try {
      ast = parse(text, { parseCustomProperty: true, onParseError: () => undefined })
    } catch {
      continue
    }
    const vars = new Set<string>()
    walk(ast, { visit: 'Declaration', enter: (d) => void (d.property.startsWith('--') && find(d.value, (n) => n.type === 'Url') && vars.add(d.property)) })
    const draws = (n: CssNode) => n.type === 'Url' || (n.type === 'Function' && n.name.toLowerCase() === 'var' && n.children.first?.type === 'Identifier' && vars.has(n.children.first.name))
    const names = new Set<string>()
    walk(ast, {
      visit: 'Rule',
      enter: (r) => {
        if (find(r.block, draws)) walk(r.prelude, { visit: 'ClassSelector', enter: (c) => void names.add(ident.decode(c.name)) })
      },
    })
    if (names.size > 0) found.set(path, names)
  }
  return found
}

const productFile = /\/products\/(?:summary|product)\.(?:d\.)?ts$/
const productTypes = new Set(['Product', 'ProductCard'])

/** A member of core's ProductCard or Product, where core declares them. */
const declaresProduct = (d: ts.Declaration): boolean => {
  const literal = d.parent
  return ts.isTypeLiteralNode(literal) && ts.isTypeAliasDeclaration(literal.parent) && productTypes.has(literal.parent.name.text) && productFile.test(d.getSourceFile().fileName)
}

/** One product (never a list of them), possibly widened with the theme's own fields. */
const isProduct = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  parts(checker.getNonNullableType(type)).some((t) => (t.isIntersection() ? t.types : [t]).some((m) => m.getProperties().some((p) => p.declarations?.some(declaresProduct) ?? false)))

/** A function rendering one product: a parameter is one, or a prop of it is (`{ product }: { product: ProductCard }`). */
const rendersProduct = (checker: ts.TypeChecker, fn: ts.SignatureDeclaration): boolean =>
  fn.parameters.some((p) => {
    const type = checker.getTypeAtLocation(p)
    return isProduct(checker, type) || parts(checker.getNonNullableType(type)).some((t) => t.getProperties().some((prop) => isProduct(checker, checker.getTypeOfSymbolAtLocation(prop, p))))
  })

const symbolOf = (checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined => {
  const symbol = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id)
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

const isMerchantImage = (checker: ts.TypeChecker, id: ts.Identifier): boolean => {
  const target = symbolOf(checker, id)
  return target?.name === 'MerchantImage' && (target.declarations?.some((d) => !inTheme(d.getSourceFile().fileName)) ?? false)
}

/** The theme's own code a name stands for (a component, a function, a value), to look inside it. */
const themeCode = (checker: ts.TypeChecker, id: ts.Identifier): ts.Node | undefined => {
  const decl = symbolOf(checker, id)?.declarations?.[0]
  if (!decl || !inTheme(decl.getSourceFile().fileName)) return undefined
  if (ts.isFunctionDeclaration(decl)) return decl
  return ts.isVariableDeclaration(decl) ? decl.initializer : undefined
}

/** The class a CSS Module's import reads (`styles.card`, `styles['card']`), and the module's path; `null` for a key worked out at run time. */
const moduleClass = (checker: ts.TypeChecker, node: ts.Node): { path: string; name: string | null } | undefined => {
  const access = ts.isPropertyAccessExpression(node) ? { of: node.expression, name: node.name.text } : ts.isElementAccessExpression(node) ? { of: node.expression, name: ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null } : undefined
  if (!access || !ts.isIdentifier(access.of)) return undefined
  const spec = importedFrom(checker, access.of)
  if (!spec?.endsWith('.module.css') || !spec.startsWith('.')) return undefined
  const full = posix.join(posix.dirname(node.getSourceFile().fileName), spec)
  return { path: full.slice(full.indexOf('/src/theme/') + 1), name: access.name }
}

/** Every <MerchantImage> or url() class a product's render reaches, at the node in it that reaches it. */
export const productImageProblems = (checker: ts.TypeChecker, sf: ts.SourceFile, urlClasses: ReadonlyMap<string, ReadonlySet<string>>): Found[] => {
  const found: Found[] = []
  const memo = new Map<ts.Node, Draws | null>()

  const drawsUrl = (node: ts.Node): Draws | null => {
    const cls = moduleClass(checker, node)
    const names = cls && urlClasses.get(cls.path)
    if (!cls || !names) return null
    if (cls.name === null) return { kind: 'url', name: 'chosen at run time' }
    return names.has(cls.name) ? { kind: 'url', name: cls.name } : null
  }

  // Memoised, and null while it is being read, so code that reaches itself ends.
  const draws = (code: ts.Node): Draws | null => {
    if (memo.has(code)) return memo.get(code) ?? null
    memo.set(code, null)
    let result: Draws | null = null
    const look = (node: ts.Node): void => {
      if (result) return
      if (ts.isIdentifier(node)) {
        if (isMerchantImage(checker, node)) result = { kind: 'image' }
        else {
          const inner = themeCode(checker, node)
          if (inner) result = draws(inner)
        }
      } else result = drawsUrl(node)
      ts.forEachChild(node, look)
    }
    look(code)
    memo.set(code, result)
    return result
  }

  const report = (node: ts.Node, what: Draws, via: string | null) => {
    const message =
      what.kind === 'image'
        ? via
          ? `${via} draws a <MerchantImage>, and here it sits inside a product's render: ${own}.`
          : `No <MerchantImage> inside a product's render: ${own}.`
        : `${via ?? `The class ${what.name}`} draws a url() picture${via ? ` (the class ${what.name})` : ''}, and here it sits inside a product's render: ${own}.`
    found.push({ node, rule, message })
  }

  const within = (outer: ts.Node, node: ts.Node) => outer.getSourceFile() === node.getSourceFile() && outer.pos <= node.pos && node.end <= outer.end

  const visit = (node: ts.Node, product: boolean): void => {
    const inProduct = product || (ts.isFunctionLike(node) && rendersProduct(checker, node))
    if (inProduct && ts.isIdentifier(node) && !ts.isJsxClosingElement(node.parent) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      const tag = ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent) ? node.parent : node
      if (isMerchantImage(checker, node)) report(tag, { kind: 'image' }, null)
      else {
        const inner = themeCode(checker, node)
        const what = inner && !within(inner, node) ? draws(inner) : null
        if (what) report(tag, what, tag === node ? node.text : `<${node.text}>`)
      }
    } else if (inProduct) {
      const what = drawsUrl(node)
      if (what) report(node, what, null)
    }
    ts.forEachChild(node, (child) => visit(child, inProduct))
  }
  visit(sf, false)
  return found
}
