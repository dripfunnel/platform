import ts from 'typescript'
import { importedFrom, inTheme, isOpen, literalStrings, parts } from './program.js'
import type { RuleId } from './rules.js'
import { isVisible, showsWrittenText } from './text.js'

export type Found = { node: ts.Node; rule: RuleId; message: string }

// ARCHITECTURE §3.4 "JSX": links, images, video, forms and inputs come from core's components; nothing loads or embeds.
const elements = new Set([
  ...['div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd'],
  ...['figure', 'figcaption', 'blockquote', 'strong', 'em', 'b', 'i', 'small', 's', 'del', 'ins', 'mark', 'br', 'hr', 'button', 'details', 'summary'],
  ...['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'time', 'abbr', 'sub', 'sup'],
  ...['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'linearGradient', 'radialGradient', 'stop'],
])
const instead = new Map([
  ['a', "core's <Link>"],
  ['img', "core's <Image>"],
  ['picture', "core's <Image>"],
  ['video', "core's <Video>"],
  ['form', "core's form components"],
  ['input', "core's form components"],
  ['select', "core's form components"],
  ['textarea', "core's form components"],
])

const attributes = new Set([
  ...['key', 'ref', 'className', 'id', 'role', 'hidden', 'tabIndex', 'title', 'lang', 'dir', 'type', 'disabled', 'open', 'colSpan', 'rowSpan', 'scope', 'headers', 'dateTime'],
  ...['onClick', 'onKeyDown', 'onKeyUp', 'onFocus', 'onBlur', 'onPointerDown', 'onPointerUp', 'onPointerMove', 'onPointerEnter', 'onPointerLeave', 'onPointerCancel'],
  ...['onMouseEnter', 'onMouseLeave', 'onTouchStart', 'onTouchMove', 'onTouchEnd', 'onScroll', 'onWheel', 'onToggle', 'onTransitionEnd', 'onAnimationEnd'],
  ...['viewBox', 'd', 'fill', 'fillRule', 'clipRule', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset', 'pathLength'],
  ...['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'points', 'transform', 'focusable', 'opacity', 'offset'],
  ...['stopColor', 'stopOpacity', 'gradientUnits', 'gradientTransform', 'preserveAspectRatio'],
])
// What a shopper reads, or hears from a screen reader, on any element or component.
const textAttributes = new Set(['alt', 'title', 'label', 'placeholder', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder', 'caption', 'heading', 'description', 'text', 'children'])
const loadingHints = new Set(['loading', 'fetchPriority', 'fetchpriority', 'priority'])

// motion's props; what they animate is checked against ARCHITECTURE §3.4 "CSS": transform, opacity and filter only.
const animationProps = new Set(['initial', 'animate', 'exit', 'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'whileDrag', 'variants', 'style'])
const motionProps = new Set([...animationProps, 'transition', 'viewport', 'layout', 'layoutId', 'drag', 'dragConstraints', 'dragElastic', 'dragMomentum', 'onAnimationStart', 'onAnimationComplete', 'onDragStart', 'onDrag', 'onDragEnd'])
const transformKeys = ['x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'skew', 'skewX', 'skewY', 'translateX', 'translateY', 'translateZ', 'transform', 'opacity']
const animatable = new Set([...transformKeys, 'filter', 'transition', 'transitionEnd'])
const styleKeys = new Set(transformKeys)
const constraintKeys = new Set(['top', 'left', 'right', 'bottom'])

const textMessage = "Words shoppers see or hear come from content/{language}/*.json through t('file.key'), never from the code."

type Kind = 'element' | 'motion' | 'theme' | 'component'

const isMotion = (from: string | undefined) => from === 'motion' || from === 'motion/react'

// A tag that holds a string, as `<Tag>` or `<Tags.a>` can, renders that element, so it is judged as one.
// An untyped tag counts too, unless it comes from a library (motion's types may be absent where the validator runs).
const holdsTag = (checker: ts.TypeChecker, tag: ts.JsxTagNameExpression) => {
  const root = ts.isPropertyAccessExpression(tag) ? tag.expression : tag
  const fromLibrary = ts.isIdentifier(root) && !(importedFrom(checker, root)?.startsWith('.') ?? true)
  return parts(checker.getTypeAtLocation(tag)).some((t) => (t.flags & ts.TypeFlags.StringLike) !== 0 || (isOpen(t) && !fromLibrary))
}

const kindOf = (checker: ts.TypeChecker, tag: ts.JsxTagNameExpression): Kind => {
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression) && isMotion(importedFrom(checker, tag.expression))) return 'motion'
  if (ts.isPropertyAccessExpression(tag)) return holdsTag(checker, tag) ? 'element' : 'component'
  if (!ts.isIdentifier(tag) || !/^[A-Z]/.test(tag.text) || holdsTag(checker, tag)) return 'element'
  const symbol = checker.getSymbolAtLocation(tag)
  const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  return target?.declarations?.some((d) => inTheme(d.getSourceFile().fileName)) ? 'theme' : 'component'
}

/** The element a tag renders; a capitalised name holding a tag string must hold exactly one, written out. */
const tagName = (checker: ts.TypeChecker, tag: ts.JsxTagNameExpression, kind: Kind): string => {
  if (ts.isJsxNamespacedName(tag)) return `${tag.namespace.text}:${tag.name.text}`
  if (kind === 'motion' || (ts.isIdentifier(tag) && !/^[A-Z]/.test(tag.text))) return ts.isPropertyAccessExpression(tag) ? tag.name.text : tag.getText()
  if (kind !== 'element') return tag.getText()
  const held = literalStrings(checker.getTypeAtLocation(tag))
  return held?.length === 1 && held[0] !== undefined ? held[0] : `${tag.getText()} (a tag held in a variable)`
}

/** Every piece of text written anywhere in an attribute's value: clsx's arguments, a template's parts. */
const writtenParts = (attr: ts.JsxAttribute): string[] => {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) found.push(node.text)
    ts.forEachChild(node, visit)
  }
  if (attr.initializer) visit(attr.initializer)
  return found
}

const valueOf = (attr: ts.JsxAttribute) => (attr.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined)

/** The literal strings an attribute holds, or undefined when it's worked out at run time. */
const writtenStrings = (checker: ts.TypeChecker, attr: ts.JsxAttribute): string[] | undefined => {
  if (attr.initializer && ts.isStringLiteral(attr.initializer)) return [attr.initializer.text]
  const value = valueOf(attr)
  return value ? literalStrings(checker.getTypeAtLocation(value)) : undefined
}

/** A theme component's prop written as words, unless the prop is declared as a choice such as 'warm' | 'cool'. */
const writesWords = (checker: ts.TypeChecker, attr: ts.JsxAttribute, strings: string[] | undefined): boolean => {
  if (attr.name.getText() === 'key' || attr.name.getText() === 'className' || !strings?.some(isVisible)) return false
  const at = attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer : valueOf(attr)
  const declared = at && checker.getContextualType(at)
  return !declared || literalStrings(checker.getNonNullableType(declared)) === undefined
}

const animated = (checker: ts.TypeChecker, at: ts.Node, type: ts.Type, keys: ReadonlySet<string>, nested: boolean): string[] =>
  parts(checker.getNonNullableType(type)).flatMap((t) => {
    if (t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.BooleanLike)) return []
    if (isOpen(t) || t.getCallSignatures().length > 0) return ['a value worked out at run time']
    if (checker.isArrayType(t)) return checker.getTypeArguments(t as ts.TypeReference).every((e) => e.flags & ts.TypeFlags.StringLike) ? [] : ['a list of values']
    return t.getProperties().flatMap((p) => (nested ? animated(checker, at, checker.getTypeOfSymbolAtLocation(p, at), keys, false) : keys.has(p.name) ? [] : [p.name]))
  })

const boundsOnly = (type: ts.Type) => parts(type).every((t) => t.getCallSignatures().length === 0 && (t.flags & ts.TypeFlags.Object) !== 0 && t.getProperties().every((p) => constraintKeys.has(p.name)))

const attributeProblems = (checker: ts.TypeChecker, kind: Kind, tag: string, attr: ts.JsxAttributeLike): Found[] => {
  if (ts.isJsxSpreadAttribute(attr)) return kind === 'element' || kind === 'motion' ? [{ node: attr, rule: 'jsx/attribute-not-allowed', message: 'Write out each attribute of an element; a {...spread} could carry anything.' }] : []
  if (ts.isJsxNamespacedName(attr.name)) return [{ node: attr, rule: 'jsx/attribute-not-allowed', message: `"${attr.name.getText()}" isn't an allowed attribute.` }]
  const name = attr.name.text
  if (name === 'dangerouslySetInnerHTML') return [{ node: attr, rule: 'jsx/dangerous-html', message: 'dangerouslySetInnerHTML is never allowed; render words through JSX and t().' }]
  if (loadingHints.has(name)) return [{ node: attr, rule: 'jsx/loading-hint', message: `Leave out "${name}": core decides which image loads first.` }]
  if (name.startsWith('data-df')) return [{ node: attr, rule: 'jsx/core-marker', message: "data-df-* attributes belong to core's components." }]
  const found: Found[] = []
  const strings = writtenStrings(checker, attr)
  const value = valueOf(attr)
  if ((name === 'className' || name === 'id') && [...(strings ?? []), ...writtenParts(attr)].some((s) => s.split(/\s+/).some((token) => token.startsWith('df-')))) {
    found.push({ node: attr, rule: 'jsx/core-marker', message: "df- class names and ids belong to core; use this theme's CSS Module classes." })
  }
  if (textAttributes.has(name) ? strings?.some(isVisible) || (value !== undefined && showsWrittenText(checker, value)) : kind === 'theme' && writesWords(checker, attr, strings)) {
    found.push({ node: attr, rule: 'jsx/text-literal', message: textMessage })
  }
  if (kind === 'theme' || kind === 'component') return found
  if (name === 'style' && kind === 'element') return [...found, { node: attr, rule: 'jsx/attribute-not-allowed', message: "Style elements through this theme's CSS Modules, never a style attribute." }]
  const allowed = attributes.has(name) || /^aria-[a-z]+$/.test(name) || /^data-[a-z][a-z0-9-]*$/.test(name) || (kind === 'motion' && motionProps.has(name))
  if (!allowed) return [...found, { node: attr, rule: 'jsx/attribute-not-allowed', message: `"${name}" isn't an allowed attribute on <${tag}>.` }]
  if (name === 'type' && (tag !== 'button' || strings?.length !== 1 || strings[0] !== 'button')) found.push({ node: attr, rule: 'jsx/attribute-not-allowed', message: 'A theme button is always type="button"; forms come from core.' })
  if (kind === 'motion' && animationProps.has(name) && value) {
    const bad = animated(checker, value, checker.getTypeAtLocation(value), name === 'style' ? styleKeys : animatable, name === 'variants')
    if (bad.length) found.push({ node: attr, rule: 'jsx/animated-property', message: `Animate only transform, opacity and filter (x, y, scale, rotate, opacity, filter), not ${[...new Set(bad)].join(', ')}.` })
  }
  if (name === 'dragConstraints' && (!value || !boundsOnly(checker.getTypeAtLocation(value)))) {
    found.push({ node: attr, rule: 'jsx/attribute-not-allowed', message: 'dragConstraints takes { top, left, right, bottom } in pixels, never a ref to another element.' })
  }
  return found
}

const openingProblems = (checker: ts.TypeChecker, node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): Found[] => {
  const kind = kindOf(checker, node.tagName)
  const tag = tagName(checker, node.tagName, kind)
  const found = node.attributes.properties.flatMap((attr) => attributeProblems(checker, kind, tag, attr))
  const typed = node.attributes.properties.some((a) => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === 'type')
  // A button with no type submits the form around it, and core's forms are the only forms (§3.4).
  if ((kind === 'element' || kind === 'motion') && tag === 'button' && !typed) found.push({ node, rule: 'jsx/attribute-not-allowed', message: 'Write type="button" on every theme button; without it a button submits the form it sits in, and forms come from core.' })
  if (kind === 'theme' || kind === 'component' || elements.has(tag)) return found
  const use = instead.get(tag)
  return [{ node, rule: 'jsx/element-not-allowed', message: use ? `<${tag}> isn't allowed in a theme; use ${use}.` : `<${tag}> isn't allowed in a theme.` }, ...found]
}

const childProblems = (checker: ts.TypeChecker, children: ts.NodeArray<ts.JsxChild>): Found[] =>
  children.flatMap((child): Found[] => {
    const written = ts.isJsxText(child) ? isVisible(child.text) : ts.isJsxExpression(child) && child.expression !== undefined && showsWrittenText(checker, child.expression)
    return written ? [{ node: child, rule: 'jsx/text-literal', message: textMessage }] : []
  })

/** The JSX rules of ARCHITECTURE §3.4 for one node: an element's tag and attributes, or the text among its children. */
export const jsxProblems = (checker: ts.TypeChecker, node: ts.JsxOpeningElement | ts.JsxSelfClosingElement | ts.JsxElement | ts.JsxFragment): Found[] =>
  ts.isJsxElement(node) || ts.isJsxFragment(node) ? childProblems(checker, node.children) : openingProblems(checker, node)
