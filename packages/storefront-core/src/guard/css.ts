import { find, ident, parse, walk, type CssNode, type Declaration, type Selector, type WalkContext } from 'css-tree'
import { animatedProperties as animated, animationAdvice } from './animation.js'
import { mediaIdPattern, problem, type GuardContext, type Problem, type RuleId } from './rules.js'

/** The highest z-index a theme may use, so core's own layers stay above it (ARCHITECTURE §3.4 "CSS"). */
export const maxThemeZIndex = 99

/**
 * What a stylesheet is: a CSS Module, the theme's Tailwind entry (`theme.css`: tokens and keyframes only), or the CSS
 * Tailwind writes for one class, judged as if the theme had written it (ARCHITECTURE §3.4 "Classes").
 */
type Kind = { kind: 'module' } | { kind: 'entry' } | { kind: 'class'; own: string }

/** How CSS names a theme image: `url(media/haldi-home.webp)` (#1405). */
const themeMediaPrefix = 'media/'

const atRules: Record<Kind['kind'], ReadonlySet<string>> = {
  module: new Set(['media', 'supports', 'container', 'keyframes']),
  entry: new Set(['theme', 'keyframes']),
  // `@property` only for Tailwind's own `--tw-*` names, checked below.
  class: new Set(['media', 'supports', 'container', 'property']),
}
// Tailwind's transition classes also name its gradient stops, which it registers as colours.
const classAnimated = new Set([...animated, '--tw-gradient-from', '--tw-gradient-via', '--tw-gradient-to'])
const keyframeProperties = new Set([...animated, 'animation-timing-function'])
const transitionWords = new Set(['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both', 'normal', 'allow-discrete', 'auto', 'none'])
// Properties that put words on the page (ARCHITECTURE §3.4 "No text in code"); Tailwind's content classes write --tw-content.
const textProperties = new Set(['content', 'quotes', 'list-style', 'list-style-type', 'text-overflow', 'text-emphasis', 'text-emphasis-style', 'hyphenate-character', '--tw-content'])
const functions = new Set([
  ...['var', 'calc', 'min', 'max', 'clamp', 'minmax', 'fit-content', 'repeat', 'env', 'counter', 'counters', 'round', 'mod', 'rem', 'abs', 'sign'],
  ...['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark'],
  ...['linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient'],
  ...['translate', 'translatex', 'translatey', 'translatez', 'translate3d', 'scale', 'scalex', 'scaley', 'scale3d', 'rotate', 'rotatex', 'rotatey', 'rotatez'],
  ...['skew', 'skewx', 'skewy', 'matrix', 'perspective', 'inset', 'circle', 'ellipse', 'polygon', 'cubic-bezier', 'steps', 'linear'],
  ...['blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia'],
  // Scroll-driven animation's timelines (#1245).
  ...['scroll', 'view'],
])
const pseudoClasses = new Set([
  ...['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'disabled', 'enabled', 'checked', 'open', 'empty', 'target', 'not', 'is', 'where', 'has'],
  ...['first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type', 'last-of-type', 'only-of-type', 'nth-of-type', 'nth-last-of-type'],
])
// Tailwind's `open:` also matches an open popover, which a theme can't make (§3.4 "JSX"), so it only ever names `[open]`.
const classPseudoClasses = new Set([...pseudoClasses, 'popover-open'])
// `::part` is how a theme styles core's sealed components (§3.5).
const pseudoElements = new Set(['before', 'after', 'marker', 'placeholder', 'selection', 'part'])
// The markers Tailwind's group-* and peer-* variants read, optionally named (`group/card`).
const markerClass = /^(?:group|peer)(?:\/[A-Za-z0-9_-]+)?$/

/** A name as the browser reads it: escapes decoded, so `\67lobal` is `global`, and in lower case. */
const plain = (raw: string) => ident.decode(raw).toLowerCase()
const unprefixed = (property: string) => property.replace(/^-(?:webkit|moz|ms|o)-/, '')
const localName = (name: string) => name.slice(name.lastIndexOf('|') + 1)

const namesCore = (node: CssNode): boolean => {
  if (node.type === 'ClassSelector' || node.type === 'IdSelector') return plain(node.name).startsWith('df-')
  if (node.type === 'TypeSelector') return localName(plain(node.name)).startsWith('df-')
  if (node.type !== 'AttributeSelector') return false
  const name = localName(plain(node.name.name))
  return name === 'class' || name === 'id' || name.startsWith('data-df')
}

/** The properties a transition or will-change names; a transition naming none animates `all`. */
const transitioned = (decl: Declaration, shorthand: boolean): string[] => {
  if (decl.value.type !== 'Value') return ['a value that can\'t be read']
  const lists: string[][] = [[]]
  decl.value.children.forEach((node) => {
    if (node.type === 'Operator' && node.value === ',') lists.push([])
    else if (node.type === 'Identifier') lists.at(-1)?.push(plain(node.name))
    else if (node.type === 'Function') lists.at(-1)?.push(`${plain(node.name)}()`)
  })
  return lists.flatMap((names) => {
    if (names.includes('none')) return []
    // initial, unset and the other CSS-wide keywords reset transition-property to all, so they stay named and are refused.
    const named = names.filter((n) => !transitionWords.has(n) && !n.endsWith('()'))
    const worked = names.filter((n) => n === 'var()')
    return [...(shorthand && named.length === 0 && worked.length === 0 ? ['all'] : named), ...worked]
  })
}

/** Exactly `var(--tw-content)`: what Tailwind's before: and after: write, holding only what a checked content class set. */
const isTailwindContent = (decl: Declaration) => {
  const only = decl.value.type === 'Value' && decl.value.children.size === 1 ? decl.value.children.first : null
  const name = only?.type === 'Function' && plain(only.name) === 'var' && only.children.size === 1 ? only.children.first : null
  return name?.type === 'Identifier' && name.name === '--tw-content'
}

const declarationProblem = (decl: Declaration, inKeyframes: boolean, siblings: readonly CssNode[], kind: Kind): [RuleId, string] | undefined => {
  const property = unprefixed(plain(decl.property))
  if (inKeyframes && !keyframeProperties.has(property)) return ['css/animated-property', `Keyframes may ${animationAdvice([property])}.`]
  const namesProperty = siblings.some((d) => d.type === 'Declaration' && ['transition', 'transition-property'].includes(unprefixed(plain(d.property))))
  const allowed = kind.kind === 'class' ? classAnimated : animated
  const bad =
    property === 'transition' || property === 'transition-property' || property === 'will-change'
      ? transitioned(decl, property === 'transition').filter((p) => !allowed.has(p))
      : property === 'transition-duration' && !namesProperty ? ['all'] : []
  if (bad.length > 0) return ['css/animated-property', `Transitions may ${animationAdvice(bad)}; name each in transition-property.`]
  if (property === 'z-index') {
    const only = decl.value.type === 'Value' && decl.value.children.size === 1 ? decl.value.children.first : null
    const fine = only?.type === 'Identifier' ? plain(only.name) === 'auto' : only?.type === 'Number' && /^-?\d+$/.test(only.value) && Number(only.value) <= maxThemeZIndex
    if (!fine) return ['css/z-index', `z-index must be a whole number no higher than ${maxThemeZIndex}, so core's parts stay on top.`]
  }
  const words = (n: CssNode) => (n.type === 'String' && n.value !== '') || (n.type === 'Function' && plain(n.name) === 'var')
  if (textProperties.has(property) && find(decl.value, words) !== null && !(kind.kind === 'class' && property === 'content' && isTailwindContent(decl))) {
    return ['css/text', `CSS ${property} may not hold words; shoppers' words come from content/{language}/*.json.`]
  }
  if (property === 'composes' && find(decl.value, (n) => n.type === 'Identifier' && plain(n.name) === 'from') !== null) {
    return ['css/composes', "composes may name only this module's own classes, never another file's or a global one."]
  }
  return undefined
}

// The universal selector and the page's own elements could pick out core's parts, inside :is() and :not() too.
const pageWide = new Set(['*', 'html', 'body'])

/** Whether a + or ~ leads to something other than a class of this module, such as `.a ~ *` or `.a + body`. */
const leavesModule = (selector: Selector) => {
  const items = selector.children.toArray()
  return items.some((n, i) => n.type === 'Combinator' && (n.name === '+' || n.name === '~') && items[i + 1]?.type !== 'ClassSelector')
}

const startsWithClass = (selector: Selector) => selector.children.first?.type === 'ClassSelector'

/** The leading compound of a selector: everything before its first combinator. */
const firstCompound = (selector: Selector): CssNode[] => {
  const items = selector.children.toArray()
  const end = items.findIndex((n) => n.type === 'Combinator')
  return end < 0 ? items : items.slice(0, end)
}

const innerSelectors = (node: CssNode): Selector[] =>
  node.type === 'PseudoClassSelector' && node.children ? node.children.toArray().flatMap((list) => (list.type === 'SelectorList' ? list.children.toArray().filter((s): s is Selector => s.type === 'Selector') : [])) : []

/**
 * A class's selector as Tailwind writes it: its own class first, or wrapped whole in `:where()` (space-y, divide-y). The
 * `*` closing an `:is()` on that class (`.x:is(:where(.group):hover *)`) is the element itself, so it reaches nothing else.
 */
const classSelector = (selector: Selector, own: string): { owned: boolean; self: Set<CssNode> } => {
  const compound = firstCompound(selector)
  const [only] = compound
  if (compound.length === 1 && only?.type === 'PseudoClassSelector' && ['where', 'is'].includes(plain(only.name))) {
    const inner = innerSelectors(only)
    const [wrapped] = inner
    return inner.length === 1 && wrapped ? classSelector(wrapped, own) : { owned: false, self: new Set() }
  }
  const owned = compound[0]?.type === 'ClassSelector' && ident.decode(compound[0].name) === own
  const self = new Set<CssNode>()
  for (const part of compound) {
    if (part.type !== 'PseudoClassSelector' || plain(part.name) !== 'is') continue
    for (const inner of innerSelectors(part)) {
      const items = inner.children.toArray()
      const last = items.at(-1)
      if (last?.type === 'TypeSelector' && last.name === '*' && items.at(-2)?.type === 'Combinator') self.add(last)
    }
  }
  return { owned, self }
}

const unreadable = "This CSS can't be read: write each rule out on its own, without nesting or escapes."

/**
 * The CSS rules of ARCHITECTURE §3.4 over one stylesheet. A CSS Module's selectors start with its own class; the theme's
 * Tailwind entry holds only `@theme` tokens and `@keyframes`; a class's CSS names only its own element.
 */
const check = (text: string, context: GuardContext, storeData: boolean, kind: Kind, report: (line: number, rule: RuleId, message: string) => void, images: ReadonlySet<string> = new Set()) => {
  const at = (node: CssNode | null, rule: RuleId, message: string) => report(node?.loc?.start.line ?? 1, rule, message)
  // Without the store's data (a local check, #974) a url() is held only to a media id's shape; the build checks the id.
  const media = storeData ? new Set(context.mediaIds) : { has: (value: string) => mediaIdPattern.test(value) }
  let ast: CssNode
  try {
    ast = parse(text, {
      positions: true,
      parseCustomProperty: true,
      onParseError: (error) => report(typeof error.line === 'number' ? error.line : 1, 'css/unreadable', `This CSS can't be read: ${error.message}.`),
    })
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return report(1, 'css/unreadable', "This CSS can't be read: it nests too deeply.")
  }
  const self = new Set<CssNode>()
  walk(ast, function (this: WalkContext, node: CssNode) {
    const inKeyframes = this.atrule !== null && plain(this.atrule.name) === 'keyframes'
    switch (node.type) {
      case 'Raw':
        // Nested rules, and anything else css-tree leaves unread but a plain name such as ::part(price), are refused unchecked.
        if (this.function === null ? node.value.trim() !== '' : !/^[\s\w-]*$/.test(node.value)) at(node, 'css/unreadable', unreadable)
        break
      case 'Atrule': {
        const name = plain(node.name)
        if (!atRules[kind.kind].has(name)) {
          const allowed = kind.kind === 'entry' ? 'only @theme (tokens) and @keyframes' : 'only @media, @supports, @container and @keyframes (fonts come from core)'
          at(node, 'css/at-rule-not-allowed', `@${node.name} isn't allowed in ${kind.kind === 'entry' ? 'theme.css' : 'a theme'}; use ${allowed}.`)
        }
        const words = node.prelude?.type === 'AtrulePrelude' ? node.prelude.children.toArray() : []
        if (kind.kind === 'class' && name === 'property' && !words.every((w) => w.type === 'Identifier' && w.name.startsWith('--tw-'))) {
          at(node, 'css/at-rule-not-allowed', '@property is only for the names Tailwind registers itself.')
        }
        if (kind.kind === 'entry' && name === 'theme' && !words.every((w) => w.type === 'Identifier' && ['inline', 'static'].includes(plain(w.name)))) {
          at(node, 'css/theme-entry', '@theme takes only the words inline or static.')
        }
        if (kind.kind === 'entry' && name === 'theme' && this.atrule !== null) at(node, 'css/theme-entry', 'Write @theme at the top of theme.css, never inside another rule.')
        break
      }
      case 'Rule':
        if (kind.kind === 'entry' && !inKeyframes) at(node, 'css/theme-entry', "theme.css holds only @theme tokens and @keyframes; style elements with Tailwind classes or a CSS Module's classes.")
        break
      case 'Selector': {
        if (inKeyframes || kind.kind === 'entry') break
        if (kind.kind === 'class' && this.function === null) {
          const found = classSelector(node, kind.own)
          for (const n of found.self) self.add(n)
          if (!found.owned) at(node, 'css/selector-not-scoped', "A class may style only its own element and what is inside it; this one reaches outside it (a variant such as [body_&], *: or in-*).")
        }
        if (kind.kind === 'module' && this.function === null && !startsWithClass(node)) at(node, 'css/selector-not-scoped', 'Every selector must start with a class of this CSS Module, such as .card h2.')
        if (this.function === null && leavesModule(node)) at(node, 'css/selector-not-scoped', 'A + or ~ must lead to another class of this CSS Module, such as .item + .item; a sibling outside the module could be one of core\'s parts.')
        break
      }
      case 'ClassSelector':
        if (kind.kind === 'class' && ident.decode(node.name) !== kind.own && !markerClass.test(ident.decode(node.name))) {
          at(node, 'css/core-selector', `A class may name only itself and Tailwind's group and peer markers, not .${ident.decode(node.name)}, which could be one of core's parts.`)
        } else if (namesCore(node)) at(node, 'css/core-selector', coreSelector)
        break
      case 'IdSelector':
        if (kind.kind === 'class') at(node, 'css/core-selector', 'A class may not select by id.')
        else if (namesCore(node)) at(node, 'css/core-selector', coreSelector)
        break
      case 'PseudoClassSelector': {
        const name = plain(node.name)
        if (name === 'global' || name === 'local') {
          at(node, 'css/global', `:${name} is never allowed; style only this module's own classes.`)
          return walk.skip
        }
        if (!(kind.kind === 'class' ? classPseudoClasses : pseudoClasses).has(name)) at(node, 'css/pseudo-not-allowed', `:${node.name} isn't allowed in a theme.`)
        break
      }
      case 'PseudoElementSelector':
        if (!pseudoElements.has(plain(node.name))) at(node, 'css/pseudo-not-allowed', `::${node.name} isn't allowed in a theme.`)
        break
      case 'Url':
        if (kind.kind === 'class') at(node, 'css/url-not-media', "A class may not hold url(); draw a store picture with core's <MerchantImage>, or put its url(<media id>) in a CSS Module.")
        else if (node.value.startsWith(themeMediaPrefix)) {
          const image = node.value.slice(themeMediaPrefix.length)
          if (!images.has(image)) at(node, 'css/media-not-found', `url(${node.value}) names no image in src/theme/media/; add "${image}" there, or name one that is.`)
        } else if (!media.has(node.value)) at(node, 'css/url-not-media', `url() may name only one of the store's media ids or media/<an image in src/theme/media/>, not "${node.value}".`)
        break
      case 'Function':
        if (!functions.has(plain(node.name))) at(node, 'css/function-not-allowed', `${node.name}() isn't allowed in a theme's CSS.`)
        break
      case 'Declaration': {
        if (kind.kind === 'entry' && this.atrule !== null && plain(this.atrule.name) === 'theme') {
          const name = plain(node.property)
          if (!name.startsWith('--') || name.startsWith('--tw-') || name.startsWith('--df-')) {
            at(node, 'css/theme-entry', `@theme holds only the theme's own tokens, custom properties such as --color-ink; not ${node.property} (--tw-* is Tailwind's and --df-* core's).`)
          }
        }
        const found = declarationProblem(node, inKeyframes, this.block?.children.toArray() ?? [], kind)
        if (found) at(node, found[0], found[1])
        break
      }
      default:
        if (node.type === 'TypeSelector' && pageWide.has(localName(plain(node.name))) && !self.has(node)) {
          at(node, 'css/selector-not-scoped', `"${node.name}" reaches outside ${kind.kind === 'class' ? 'the element' : 'this module'}; select only ${kind.kind === 'class' ? 'the element and the elements inside it' : "this module's classes and the elements inside them"}.`)
        }
        if (namesCore(node)) at(node, 'css/core-selector', coreSelector)
    }
  })
}

const coreSelector = "Theme CSS may not name core's classes or df- elements, or select by class or id attribute; style core's parts through their documented properties and ::part."

/** The CSS Module rules of ARCHITECTURE §3.4 for one file, or the theme's Tailwind entry's when `entry` is set. */
export const checkCss = (file: string, text: string, context: GuardContext, storeData = true, entry = false, images: ReadonlySet<string> = new Set()): Problem[] => {
  const problems: Problem[] = []
  check(text, context, storeData, entry ? { kind: 'entry' } : { kind: 'module' }, (line, rule, message) => problems.push(problem(file, line, rule, message)), images)
  return problems
}

/** The CSS rules over what Tailwind writes for the class `own` (ARCHITECTURE §3.4 "Classes"): each broken rule once. */
export const checkClassCss = (own: string, css: string, context: GuardContext): [RuleId, string][] => {
  const found = new Map<string, [RuleId, string]>()
  check(css, context, false, { kind: 'class', own }, (_line, rule, message) => found.set(`${rule} ${message}`, [rule, message]))
  return [...found.values()]
}
