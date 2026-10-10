import ts from 'typescript'
import { brandCopied } from './brand.js'
import { interactiveFolder } from './files.js'
import { jsxProblems } from './jsx.js'
import { coreThemeModule, inTheme, isOpen, lineOf, literalStrings, parts, themeProgram } from './program.js'
import { problem, type GuardContext, type Problem, type RuleId } from './rules.js'
import { isAddress, looksLikeWords, showsWrittenText } from './text.js'

/** A `t('file.key')` call, matched against the content files. */
export type KeyUse = { file: string; line: number; key: string }

type Library = { names: ReadonlySet<string> | 'any'; defaultImport: boolean; interactiveOnly: boolean }

// motion's components and hooks that act only on their own element; `animate` and `useAnimate` take selectors.
const motion: Library = { names: new Set(['AnimatePresence', 'LazyMotion', 'MotionConfig', 'domAnimation', 'domMax', 'm', 'motion', 'useMotionValue', 'useReducedMotion', 'useSpring', 'useTransform']), defaultImport: false, interactiveOnly: true }

// The import allowlist of ARCHITECTURE §3.4; React's names that render raw elements or load code are left out.
const libraries = new Map<string, Library>([
  ['react', { names: new Set(['Fragment', 'Suspense', 'createContext', 'forwardRef', 'memo', 'startTransition', 'use', 'useCallback', 'useContext', 'useDeferredValue', 'useEffect', 'useId', 'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState', 'useTransition']), defaultImport: false, interactiveOnly: false }],
  [coreThemeModule, { names: 'any', defaultImport: false, interactiveOnly: false }],
  ['clsx', { names: new Set(['clsx']), defaultImport: true, interactiveOnly: false }],
  ['motion', motion],
  ['motion/react', motion],
])

/** The language's own globals a theme may use, and the members it may use of those that have more. */
const globals = new Map<string, ReadonlySet<string> | 'any'>([
  ...['undefined', 'NaN', 'Infinity', 'Array', 'Boolean', 'Error', 'Map', 'Number', 'Promise', 'Set', 'String', 'isFinite', 'isNaN', 'parseFloat', 'parseInt'].map((g) => [g, 'any'] as const),
  ...['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((g) => [g, 'any'] as const),
  ['JSON', new Set(['parse', 'stringify'])],
  ['Object', new Set(['entries', 'freeze', 'fromEntries', 'hasOwn', 'keys', 'values'])],
  // Math.random would make two builds of the same commit differ (LIVE-SHOP §4 step 3).
  ['Math', new Set([
    ...['abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'ceil', 'clz32', 'cos', 'cosh', 'exp', 'expm1', 'floor', 'fround', 'hypot', 'imul'],
    ...['log', 'log10', 'log1p', 'log2', 'max', 'min', 'pow', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc'],
    ...['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2'],
  ])],
])
const timers = new Set(['setTimeout', 'setInterval'])

const prototypeMembers = new Set(['constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'])
// Reached through any value, since an event's view, a ref's owner or a cast can lead to the window.
// Names with no use but the browser's; `top`, `location`, `history` and the like are judged by the value's type instead (a rect's top is fine).
const browserMembers = new Set([
  ...['window', 'document', 'globalThis', 'opener', 'frameElement', 'defaultView', 'ownerDocument', 'navigator'],
  ...['fetch', 'localStorage', 'sessionStorage', 'indexedDB', 'cookieStore', 'eval', 'Function', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
  ...['sendBeacon', 'postMessage', 'Worker', 'SharedWorker', 'serviceWorker', 'importScripts', 'requestIdleCallback'],
])
const scriptMembers = new Set(['currentScript'])
const walkingMembers = new Set([
  ...['parentElement', 'parentNode', 'closest', 'querySelector', 'querySelectorAll', 'getRootNode', 'shadowRoot', 'attachShadow', 'innerHTML', 'outerHTML', 'innerText'],
  ...['textContent', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText', 'setHTMLUnsafe', 'childNodes', 'firstChild', 'lastChild', 'firstElementChild'],
  ...['lastElementChild', 'nextSibling', 'previousSibling', 'nextElementSibling', 'previousElementSibling', 'offsetParent', 'assignedSlot', 'getElementById'],
  ...['getElementsByClassName', 'getElementsByTagName', 'appendChild', 'removeChild', 'replaceChildren', 'replaceWith', 'setAttribute', 'setAttributeNS', 'cloneNode'],
  ...['elementFromPoint', 'elementsFromPoint', 'composedPath', 'relatedTarget'],
])
// "A ref may style its own element and nothing else" (ARCHITECTURE §3.4).
const elementMembers = new Set([
  ...['style', 'classList', 'focus', 'blur', 'getBoundingClientRect', 'scrollIntoView', 'scrollTo', 'scrollBy', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight'],
  ...['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight', 'addEventListener', 'removeEventListener', 'setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'],
])
// Inline styles animate only what CSS may (§3.4 "CSS"), and custom properties through setProperty.
const customPropertyCalls = new Set(['setProperty', 'removeProperty'])
const styleMembers = new Set(['transform', 'opacity', 'filter', 'translate', 'scale', 'rotate', 'setProperty', 'removeProperty'])
const browserTypes = new Set(['Window', 'WindowProxy', 'Document', 'Location', 'Navigator', 'Storage', 'History', 'Screen', 'CookieStore', 'CacheStorage', 'IDBFactory', 'Performance', 'Crypto', 'Console'])

const memberMessage = (global: string, name: string, allowed: ReadonlySet<string>) =>
  global === 'Math' && name === 'random'
    ? 'A theme may not use Math.random: two builds of the same commit must come out the same (LIVE-SHOP §4 step 3).'
    : `A theme may not use ${global}.${name}; of ${global} it may use only ${[...allowed].join(', ')}.`

const browserMessage = (name: string) => `A theme may not use "${name}". Data comes from core's useStorefront() and its components; a ref may only style its own element.`

type Walk = {
  file: string
  interactive: boolean
  checker: ts.TypeChecker
  program: ts.Program
  copied: (text: string) => string | undefined
  keys: KeyUse[]
  quiet: Set<ts.Node>
  /** Whether each type met so far holds t, kept for the whole program since the checker is shared. */
  holds: Map<ts.Type, boolean>
  report: (node: ts.Node, rule: RuleId, message: string) => void
}

const fromLibrary = (w: Walk, d: ts.Declaration) => w.program.isSourceFileDefaultLibrary(d.getSourceFile())

/** 'dom' for a value typed as a DOM node, 'style' for an inline style, 'browser' for the window and its kin, 'open' for any or unknown. */
const kindOfValue = (w: Walk, type: ts.Type): 'dom' | 'style' | 'browser' | 'open' | undefined => {
  const all = parts(w.checker.getNonNullableType(type))
  if (all.some(isOpen)) return 'open'
  const named = (t: ts.Type, names: ReadonlySet<string>) => {
    const symbol = t.getSymbol() ?? t.aliasSymbol
    return symbol !== undefined && names.has(symbol.name) && (symbol.declarations ?? []).some((d) => fromLibrary(w, d))
  }
  if (all.some((t) => named(t, browserTypes))) return 'browser'
  if (all.some((t) => named(t, new Set(['CSSStyleDeclaration'])))) return 'style'
  // An event's target is typed EventTarget, which a cast would otherwise turn into a node.
  const isNode = (t: ts.Type) =>
    named(t, new Set(['EventTarget'])) || (w.checker.getPropertyOfType(w.checker.getApparentType(t), 'nodeType')?.declarations?.some((d) => fromLibrary(w, d)) ?? false)
  return all.some(isNode) ? 'dom' : undefined
}

/** Whether an identifier reads a value, as opposed to naming a declaration, a property, a type or an element. */
const isValueReference = (id: ts.Identifier): boolean => {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p)) return p.expression === id
  if (ts.isQualifiedName(p) || ts.isMetaProperty(p) || ts.isTypeReferenceNode(p)) return false
  if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) return /^[A-Z]/.test(id.text)
  if (ts.isJsxClosingElement(p) || ts.isJsxAttribute(p) || ts.isJsxNamespacedName(p)) return false
  if (ts.isBindingElement(p)) return p.initializer === id
  if (ts.isShorthandPropertyAssignment(p)) return true
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false
  if (ts.isExportSpecifier(p)) return p.parent.parent.moduleSpecifier === undefined && (p.propertyName ?? p.name) === id
  return (p as ts.Node & { name?: ts.Node }).name !== id
}

/** A name the theme neither declares nor imports: one of the browser's or the language's globals, or nothing at all. */
const isGlobal = (w: Walk, id: ts.Identifier): boolean => {
  const p = id.parent
  const symbol = ts.isShorthandPropertyAssignment(p) ? w.checker.getShorthandAssignmentValueSymbol(p) : ts.isExportSpecifier(p) ? w.checker.getExportSpecifierLocalTargetSymbol(p) : w.checker.getSymbolAtLocation(id)
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) return false
  const declarations = symbol?.declarations ?? []
  return declarations.length === 0 || !declarations.every((d) => inTheme(d.getSourceFile().fileName))
}

const globalName = (w: Walk, node: ts.Expression): string | undefined => (ts.isIdentifier(node) && isGlobal(w, node) ? node.text : undefined)

const checkMember = (w: Walk, node: ts.Node, object: ts.Expression | undefined, type: ts.Type | undefined, name: string) => {
  if (prototypeMembers.has(name)) return w.report(node, 'code/prototype-access', `A theme may not reach "${name}"; it leads to the code behind every value.`)
  if (scriptMembers.has(name)) return w.report(node, 'code/script-url', "A theme may not learn its own script's address; core's chunk loader alone handles it.")
  const global = object && globalName(w, object)
  if (global !== undefined) {
    const allowed = globals.get(global)
    if (allowed !== undefined && allowed !== 'any' && !allowed.has(name)) w.report(node, 'code/browser-global', memberMessage(global, name, allowed))
    return
  }
  if (browserMembers.has(name)) return w.report(node, 'code/browser-global', browserMessage(name))
  const kind = type && kindOfValue(w, type)
  if (walkingMembers.has(name) || (kind === 'dom' && !elementMembers.has(name))) {
    return w.report(node, 'code/dom-walking', `A theme may not use "${name}" on an element: a ref may only style its own element. Read data from core's hooks instead.`)
  }
  if (kind === 'style' && !styleMembers.has(name)) return w.report(node, 'code/dom-walking', `Inline styles may set only transform, opacity, filter and custom properties, not "${name}"; style the rest in a CSS Module.`)
  if (kind === 'browser') w.report(node, 'code/browser-global', browserMessage(name))
}

const openKey = ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping | ts.TypeFlags.ESSymbolLike

/** A computed `[key]`: written text is judged as a member, and so is every name a key's type can hold. */
const checkKey = (w: Walk, node: ts.Node, object: ts.Expression | undefined, type: ts.Type, key: ts.Expression) => {
  if (ts.isStringLiteralLike(key)) {
    w.quiet.add(key)
    return checkMember(w, node, object, type, key.text)
  }
  const kind = kindOfValue(w, type)
  if (kind === 'dom' || kind === 'style' || kind === 'browser') return w.report(node, 'code/dom-walking', 'A theme may not look up an element, a style or the window with a computed [key].')
  const keyType = w.checker.getTypeAtLocation(key)
  const names = literalStrings(keyType)
  if (names) return names.forEach((n) => checkMember(w, node, object, type, n))
  if (parts(keyType).some((t) => (t.flags & openKey) !== 0)) w.report(node, 'code/prototype-access', 'Look a value up with a written key, or a key typed as a list of names; an open string can reach the code behind every value.')
}

const checkBindingPattern = (w: Walk, pattern: ts.ObjectBindingPattern) => {
  const type = w.checker.getTypeAtLocation(pattern)
  const holder = pattern.parent
  const source = ts.isVariableDeclaration(holder) ? holder.initializer : undefined
  for (const el of pattern.elements) {
    const name = el.propertyName ?? el.name
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) checkMember(w, el, source, type, name.text)
    else if (ts.isComputedPropertyName(name)) checkKey(w, el, source, type, name.expression)
  }
}

/** `({ a: x } = y)` and `for ({ a } of ys)`: each name read from the right side is judged as a member of it, as a binding pattern is. */
const checkAssignedPattern = (w: Walk, pattern: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, source: ts.Expression | undefined, type: ts.Type) => {
  if (ts.isArrayLiteralExpression(pattern)) {
    const element = w.checker.getIndexTypeOfType(type, ts.IndexKind.Number) ?? type
    for (const el of pattern.elements) {
      const target = ts.isSpreadElement(el) ? el.expression : ts.isBinaryExpression(el) ? el.left : el
      if (ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)) checkAssignedPattern(w, target, undefined, element)
    }
    return
  }
  for (const p of pattern.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue
    const name = p.name
    if (ts.isComputedPropertyName(name)) checkKey(w, p, source, type, name.expression)
    else if (ts.isIdentifier(name) || ts.isStringLiteral(name)) checkMember(w, p, source, type, name.text)
    const value = ts.isPropertyAssignment(p) ? (ts.isBinaryExpression(p.initializer) ? p.initializer.left : p.initializer) : undefined
    if (value && (ts.isObjectLiteralExpression(value) || ts.isArrayLiteralExpression(value))) {
      const inner = !ts.isComputedPropertyName(name) && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? w.checker.getPropertyOfType(type, name.text) : undefined
      checkAssignedPattern(w, value, undefined, inner ? w.checker.getTypeOfSymbol(inner) : w.checker.getAnyType())
    }
  }
}

const assignedPattern = (node: ts.Node): [ts.ObjectLiteralExpression | ts.ArrayLiteralExpression, ts.Expression] | undefined => {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && (ts.isObjectLiteralExpression(node.left) || ts.isArrayLiteralExpression(node.left))) return [node.left, node.right]
  if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && (ts.isObjectLiteralExpression(node.initializer) || ts.isArrayLiteralExpression(node.initializer))) return [node.initializer, node.expression]
  return undefined
}

// A library's names passed on from one theme file to another would escape the checks tied to their import.
const reexportMessage = "A theme passes on only its own code; import a library's names in the file that uses them."

const passesOnLibrary = (w: Walk, specifier: ts.ExportSpecifier): boolean => {
  const decl = w.checker.getExportSpecifierLocalTargetSymbol(specifier)?.declarations?.[0]
  const statement = decl && (ts.isImportSpecifier(decl) ? decl.parent.parent.parent : ts.isNamespaceImport(decl) ? decl.parent.parent : ts.isImportClause(decl) ? decl.parent : undefined)
  return statement !== undefined && ts.isStringLiteral(statement.moduleSpecifier) && !statement.moduleSpecifier.text.startsWith('.')
}

// motion's element factories: `motion.a` held in a name would render an element the JSX rules never see.
const motionFactories = new Set(['motion', 'm'])

const isMotionFactory = (w: Walk, id: ts.Identifier): boolean => {
  const decl = w.checker.getSymbolAtLocation(id)?.declarations?.[0]
  if (!decl || !ts.isImportSpecifier(decl)) return false
  const from = decl.parent.parent.parent.moduleSpecifier
  return ts.isStringLiteral(from) && (from.text === 'motion' || from.text === 'motion/react') && motionFactories.has((decl.propertyName ?? decl.name).text)
}

/** `motion` as the object of a tag written out, as in <motion.div> and </motion.div>. */
const isWrittenTag = (id: ts.Identifier): boolean => {
  const access = id.parent
  if (!ts.isPropertyAccessExpression(access) || access.expression !== id) return false
  const tag = access.parent
  return (ts.isJsxOpeningElement(tag) || ts.isJsxSelfClosingElement(tag) || ts.isJsxClosingElement(tag)) && tag.tagName === access
}

/** Whether a global is read only through one of its members, so the member allowlist sees every use of it. */
const readsMember = (id: ts.Identifier): boolean => {
  const p = id.parent
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === id) return true
  return ts.isVariableDeclaration(p) && p.initializer === id && ts.isObjectBindingPattern(p.name)
}

const checkIdentifier = (w: Walk, id: ts.Identifier) => {
  if (!isValueReference(id)) return
  if (id.text === 'require' && isGlobal(w, id)) return w.report(id, 'code/dynamic-import', 'A theme may not load code with require; import from the allowed modules at the top of the file.')
  if (ts.isExportSpecifier(id.parent) && passesOnLibrary(w, id.parent)) return w.report(id, 'code/import-not-allowed', reexportMessage)
  if (!isGlobal(w, id)) {
    if (kindOfValue(w, w.checker.getTypeAtLocation(id)) === 'browser') w.report(id, 'code/browser-global', browserMessage(id.text))
    if (isMotionFactory(w, id) && !isWrittenTag(id)) w.report(id, 'jsx/element-not-allowed', "Use motion's elements written out as tags, such as <motion.div>, so each one is checked; never hold one in a name or make one with create().")
    return
  }
  const called = ts.isCallExpression(id.parent) && id.parent.expression === id
  const members = globals.get(id.text)
  if (members instanceof Set && !readsMember(id)) {
    return w.report(id, 'code/browser-global', `Use ${id.text} only as ${id.text}.member, such as ${id.text}.${[...members][0]}; held in a name or passed on, its other members would go unchecked.`)
  }
  if (!globals.has(id.text) || (timers.has(id.text) && !called)) w.report(id, 'code/browser-global', browserMessage(id.text))
}

const isTranslate = (w: Walk, type: ts.Type) => parts(type).some((t) => t.aliasSymbol?.name === 'Translate' && (t.aliasSymbol.declarations ?? []).some((d) => !inTheme(d.getSourceFile().fileName)))

// The browser's own types (an element has hundreds of members) never hold core's t, so they aren't searched.
const searchable = (w: Walk, t: ts.Type) => (t.flags & ts.TypeFlags.Object) !== 0 && !(t.getSymbol()?.declarations ?? []).some((d) => fromLibrary(w, d))

const searchHolds = (w: Walk, type: ts.Type, depth: number): boolean =>
  isTranslate(w, type) || (depth > 0 && parts(type).some((t) => searchable(w, t) && t.getProperties().some((p) => searchHolds(w, w.checker.getTypeOfSymbol(p), depth - 1))))

const holdsTranslate = (w: Walk, type: ts.Type): boolean => {
  const known = w.holds.get(type)
  if (known !== undefined) return known
  const found = searchHolds(w, type, 2)
  w.holds.set(type, found)
  return found
}

/**
 * Whether an expression hands `t`, or a value holding it such as useStorefront()'s answer, to a type that drops it,
 * after which its keys could no longer be found and checked against the content (ARCHITECTURE §3.4 "Content").
 */
const losesTranslate = (w: Walk, expr: ts.Expression): boolean => {
  const type = w.checker.getTypeAtLocation(expr)
  if (!holdsTranslate(w, type)) return false
  const p = expr.parent
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === expr) return isTranslate(w, type) && !ts.isCallExpression(p.parent)
  if (ts.isCallExpression(p) && p.expression === expr) return false
  if (ts.isVariableDeclaration(p) && p.initializer === expr && p.type === undefined) return false
  if (ts.isBindingElement(p) || ts.isObjectBindingPattern(p)) return false
  const contextual = w.checker.getContextualType(expr)
  return contextual === undefined ? !ts.isExpressionStatement(p) : !holdsTranslate(w, contextual)
}

const isAssertion = (node: ts.Node): node is ts.AsExpression | ts.TypeAssertion | ts.SatisfiesExpression =>
  ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)

/** Whether an element (or its style) is cast, or handed to a type that isn't one, after which its members go unchecked. */
const losesElement = (w: Walk, expr: ts.Expression): boolean => {
  const kind = kindOfValue(w, w.checker.getTypeAtLocation(expr))
  if (kind !== 'dom' && kind !== 'style') return false
  const p = expr.parent
  const target = isAssertion(p) ? w.checker.getTypeAtLocation(p) : (w.checker.getContextualType(expr) ?? undefined)
  return target !== undefined && kindOfValue(w, target) !== kind
}

const checkCall = (w: Walk, call: ts.CallExpression) => {
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) return w.report(call, 'code/dynamic-import', 'A theme may not load code with import(); import from the allowed modules at the top of the file.')
  const callee = call.expression
  if (ts.isPropertyAccessExpression(callee) && customPropertyCalls.has(callee.name.text) && kindOfValue(w, w.checker.getTypeAtLocation(callee.expression)) === 'style') {
    const first = call.arguments[0]
    if (!first || !ts.isStringLiteralLike(first) || !first.text.startsWith('--')) {
      w.report(call, 'code/dom-walking', `${callee.name.text} takes a custom property written out, such as '--progress'; other properties are styled in a CSS Module.`)
    }
  }
  if (ts.isIdentifier(callee) && timers.has(callee.text) && isGlobal(w, callee)) {
    const first = call.arguments[0]
    if (!first || w.checker.getSignaturesOfType(w.checker.getTypeAtLocation(first), ts.SignatureKind.Call).length === 0) w.report(call, 'code/string-timer', `${callee.text} takes a function, never a string of code.`)
  }
  if (!isTranslate(w, w.checker.getTypeAtLocation(callee))) return
  const [key, values] = call.arguments
  if (key && ts.isStringLiteral(key)) {
    w.quiet.add(key)
    w.keys.push({ file: w.file, line: lineOf(key), key: key.text })
  } else {
    w.report(call, 'code/t-key-not-literal', "t() takes its key written out, such as t('pages.home.title'), so every language can be checked for it.")
  }
  if (values && ts.isObjectLiteralExpression(values)) {
    for (const p of values.properties) {
      const value = ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : undefined
      if (value && showsWrittenText(w.checker, value)) w.report(value, 'jsx/text-literal', "A value given to t() is shown to shoppers; it comes from core's data, never written in the code.")
    }
  }
}

const isChoice = (w: Walk, node: ts.StringLiteralLike): boolean => {
  const contextual = w.checker.getContextualType(node)
  return contextual !== undefined && literalStrings(w.checker.getNonNullableType(contextual)) !== undefined
}

const isName = (node: ts.Node) => {
  const p = node.parent
  return (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isEnumMember(p) || ts.isBindingElement(p)) && (p.name === node || ('propertyName' in p && p.propertyName === node))
}

const checkText = (w: Walk, node: ts.StringLiteralLike | ts.TemplateLiteralToken | ts.JsxText) => {
  if (w.quiet.has(node)) return
  const field = w.copied(node.text)
  if (field) w.report(node, 'code/brand-literal', `This repeats the store's ${field}; read it from useStorefront() so a change in Site settings reaches the site.`)
  if (ts.isJsxText(node)) return
  if (isAddress(node.text)) w.report(node, 'code/url-in-code', "A theme writes no address in its code: links go through core's <Link>, images and video through <Image> and <Video>.")
  if (ts.isJsxAttribute(node.parent) || ts.isJsxExpression(node.parent) || !looksLikeWords(node.text) || isName(node)) return
  if (!ts.isStringLiteralLike(node) || !isChoice(w, node)) w.report(node, 'code/text-in-string', "Words shoppers see belong in content/{language}/*.json, shown through t('file.key').")
}

const checkDirectives = (w: Walk, sf: ts.SourceFile) => {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return
    w.quiet.add(statement.expression)
    const text = statement.expression.text
    if (text !== 'use client') w.report(statement, 'code/directive-not-allowed', `"${text}" isn't allowed in a theme; its only directive is 'use client', in components/interactive/.`)
    else if (!w.interactive) w.report(statement, 'code/use-client-outside-interactive', "'use client' belongs only in src/theme/components/interactive/; move the interactive part there.")
  }
}

const resolveRelative = (from: string, spec: string): string => {
  const segments = from.split('/').slice(0, -1)
  for (const s of spec.split('/')) {
    if (s === '..') segments.pop()
    else if (s !== '.') segments.push(s)
  }
  return segments.join('/')
}

const checkModule = (w: Walk, node: ts.ImportDeclaration | ts.ExportDeclaration, files: ReadonlySet<string>) => {
  const spec = node.moduleSpecifier
  if (!spec) return
  if (!ts.isStringLiteral(spec)) return w.report(node, 'code/import-not-allowed', 'Name the module as written text.')
  w.quiet.add(spec)
  if (node.attributes) return w.report(node, 'code/import-not-allowed', 'A theme imports modules without import attributes.')
  if (spec.text.startsWith('.')) {
    const target = resolveRelative(w.file, spec.text)
    const exists = target.startsWith('src/theme/') && (target.endsWith('.module.css') ? files.has(target) : files.has(`${target}.tsx`))
    if (!exists) w.report(node, 'code/import-not-allowed', `"${spec.text}" isn't a component, page or CSS Module of this theme.`)
    return
  }
  const library = libraries.get(spec.text)
  if (!library) return w.report(node, 'code/import-not-allowed', `A theme may import only react, ${coreThemeModule}, clsx, motion (in components/interactive/) and its own files, not "${spec.text}".`)
  if (library.interactiveOnly && !w.interactive) w.report(node, 'code/motion-outside-interactive', 'motion may be used only in src/theme/components/interactive/, which loads it on its own.')
  const refuse = (name: string) => w.report(node, 'code/import-not-allowed', `A theme may not use "${name}" from ${spec.text}.`)
  const names = library.names
  if (ts.isExportDeclaration(node)) {
    if (!node.isTypeOnly) w.report(node, 'code/import-not-allowed', reexportMessage)
    return
  }
  const clause = node.importClause
  if (!clause) return refuse('a bare import')
  if (clause.phaseModifier === ts.SyntaxKind.DeferKeyword) return w.report(node, 'code/dynamic-import', 'A theme may not defer loading a module.')
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return
  if (clause.name && !library.defaultImport) refuse('the default export')
  const bindings = clause.namedBindings
  if (!bindings || names === 'any') return
  if (ts.isNamespaceImport(bindings)) return refuse('* as a namespace')
  for (const el of bindings.elements) if (!el.isTypeOnly && !names.has((el.propertyName ?? el.name).text)) refuse((el.propertyName ?? el.name).text)
}

const isDeclarationEscape = (node: ts.Node) =>
  ts.isModuleDeclaration(node) || ts.isImportEqualsDeclaration(node) || (ts.isExportAssignment(node) && node.isExportEquals === true) ||
  (ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false))

const openKeywords = new Set([ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword])

// An element typed any escapes every element and style check, so a theme never writes any or unknown, or leaves a parameter untyped.
const openTypeMessage = 'Give every value its real type, such as useRef<HTMLDivElement>(null) or (e: MouseEvent<HTMLButtonElement>); a value typed any or unknown would go unchecked.'

const reportOpenTypes = (w: Walk, node: ts.Node): void => {
  if (openKeywords.has(node.kind)) return w.report(node, 'code/dom-walking', openTypeMessage)
  ts.forEachChild(node, (child) => reportOpenTypes(w, child))
}

const visit = (w: Walk, node: ts.Node, files: ReadonlySet<string>): void => {
  if (ts.isExpressionWithTypeArguments(node)) return visit(w, node.expression, files)
  if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return reportOpenTypes(w, node)
  if (ts.isParameter(node) && node.type === undefined && isOpen(w.checker.getTypeAtLocation(node))) w.report(node, 'code/dom-walking', openTypeMessage)
  if (isDeclarationEscape(node)) return w.report(node, 'code/declaration-not-allowed', "A theme may not declare names that exist elsewhere ('declare', 'namespace', 'import =', 'export =').")
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    checkModule(w, node, files)
    if (ts.isImportDeclaration(node) || node.moduleSpecifier) return
  }
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) w.report(node, 'code/script-url', "A theme may not read import.meta; core's chunk loader alone handles script addresses.")
  if (ts.isExpression(node) && losesElement(w, node)) w.report(node, 'code/dom-walking', "An element goes only where an element is expected; cast or handed to another type, what's reached through it would go unchecked.")
  if (ts.isExpression(node) && losesTranslate(w, node)) w.report(node, 'code/t-key-not-literal', "Call t() as core gives it, without passing it on as another type, so every key it's called with can be checked.")
  const assigned = assignedPattern(node)
  if (assigned) {
    const [pattern, from] = assigned
    const fromType = w.checker.getTypeAtLocation(from)
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) checkAssignedPattern(w, pattern, undefined, ts.isForInStatement(node) ? w.checker.getStringType() : (w.checker.getIndexTypeOfType(fromType, ts.IndexKind.Number) ?? fromType))
    else checkAssignedPattern(w, pattern, from, fromType)
  }
  if (ts.isIdentifier(node)) checkIdentifier(w, node)
  else if (ts.isPropertyAccessExpression(node)) checkMember(w, node, node.expression, w.checker.getTypeAtLocation(node.expression), node.name.text)
  else if (ts.isElementAccessExpression(node)) checkKey(w, node, node.expression, w.checker.getTypeAtLocation(node.expression), node.argumentExpression)
  else if (ts.isObjectBindingPattern(node)) checkBindingPattern(w, node)
  else if (ts.isCallExpression(node)) checkCall(w, node)
  else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) checkText(w, node)
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    for (const found of jsxProblems(w.checker, node)) w.report(found.node, found.rule, found.message)
  }
  ts.forEachChild(node, (child) => visit(w, child, files))
}

/** The code rules of ARCHITECTURE §3.4 over every .tsx file, and the content keys the theme's t() calls ask for. */
export const checkCode = (code: ReadonlyMap<string, string>, files: ReadonlySet<string>, context: GuardContext): { problems: Problem[]; keys: KeyUse[] } => {
  const problems: Problem[] = []
  const keys: KeyUse[] = []
  if (code.size === 0) return { problems, keys }
  const { checker, program, sourceFile } = themeProgram(code)
  const copied = brandCopied(context.brand)
  const holds = new Map<ts.Type, boolean>()
  for (const file of code.keys()) {
    const sf = sourceFile(file)
    if (!sf) continue
    const syntax = program.getSyntacticDiagnostics(sf)
    for (const d of syntax) {
      const line = d.start === undefined ? 1 : sf.getLineAndCharacterOfPosition(d.start).line + 1
      problems.push(problem(file, line, 'code/unreadable', `This file can't be read: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`))
    }
    if (syntax.length > 0) continue
    const report = (node: ts.Node, rule: RuleId, message: string) => problems.push(problem(file, lineOf(node), rule, message))
    if (sf.referencedFiles.length + sf.typeReferenceDirectives.length + sf.libReferenceDirectives.length > 0) {
      problems.push(problem(file, 1, 'code/declaration-not-allowed', 'A theme may not use /// <reference> directives; it gets its types from its imports.'))
    }
    const w: Walk = { file, interactive: file.startsWith(interactiveFolder), checker, program, copied, keys, quiet: new Set(), holds, report }
    try {
      checkDirectives(w, sf)
      for (const statement of sf.statements) visit(w, statement, files)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      problems.push(problem(file, 1, 'code/unreadable', "This file can't be read: it nests too deeply."))
    }
  }
  return { problems, keys }
}
