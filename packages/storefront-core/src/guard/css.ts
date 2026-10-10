import { find, ident, parse, walk, type CssNode, type Declaration, type Selector, type WalkContext } from 'css-tree'
import { problem, type GuardContext, type Problem, type RuleId } from './rules.js'

/** The highest z-index a theme may use, so core's own layers stay above it (ARCHITECTURE §3.4 "CSS"). */
export const maxThemeZIndex = 99

const atRules = new Set(['media', 'supports', 'container', 'keyframes'])
const animated = new Set(['transform', 'opacity', 'filter'])
const keyframeProperties = new Set([...animated, 'animation-timing-function'])
const transitionWords = new Set(['ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both', 'normal', 'allow-discrete', 'auto', 'none', 'initial', 'inherit', 'unset', 'revert'])
// Properties that put words on the page (ARCHITECTURE §3.4 "No text in code").
const textProperties = new Set(['content', 'quotes', 'list-style', 'list-style-type', 'text-overflow', 'text-emphasis', 'text-emphasis-style', 'hyphenate-character'])
const functions = new Set([
  ...['var', 'calc', 'min', 'max', 'clamp', 'minmax', 'fit-content', 'repeat', 'env', 'counter', 'counters', 'round', 'mod', 'rem', 'abs', 'sign'],
  ...['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark'],
  ...['linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient'],
  ...['translate', 'translatex', 'translatey', 'translatez', 'translate3d', 'scale', 'scalex', 'scaley', 'scale3d', 'rotate', 'rotatex', 'rotatey', 'rotatez'],
  ...['skew', 'skewx', 'skewy', 'matrix', 'perspective', 'inset', 'circle', 'ellipse', 'polygon', 'cubic-bezier', 'steps', 'linear'],
  ...['blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia'],
])
const pseudoClasses = new Set([
  ...['hover', 'focus', 'focus-visible', 'focus-within', 'active', 'disabled', 'enabled', 'checked', 'open', 'empty', 'target', 'not', 'is', 'where', 'has'],
  ...['first-child', 'last-child', 'only-child', 'nth-child', 'nth-last-child', 'first-of-type', 'last-of-type', 'only-of-type', 'nth-of-type', 'nth-last-of-type'],
])
// `::part` is how a theme styles core's sealed components (§3.5).
const pseudoElements = new Set(['before', 'after', 'marker', 'placeholder', 'selection', 'part'])

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
    const named = names.filter((n) => !transitionWords.has(n) && !n.endsWith('()'))
    const worked = names.filter((n) => n === 'var()')
    return [...(shorthand && named.length === 0 && worked.length === 0 ? ['all'] : named), ...worked]
  })
}

const declarationProblem = (decl: Declaration, inKeyframes: boolean, siblings: readonly CssNode[]): [RuleId, string] | undefined => {
  const property = unprefixed(plain(decl.property))
  if (inKeyframes && !keyframeProperties.has(property)) return ['css/animated-property', `Keyframes may animate only transform, opacity and filter, not ${property}.`]
  const namesProperty = siblings.some((d) => d.type === 'Declaration' && ['transition', 'transition-property'].includes(unprefixed(plain(d.property))))
  const bad =
    property === 'transition' || property === 'transition-property' || property === 'will-change'
      ? transitioned(decl, property === 'transition').filter((p) => !animated.has(p))
      : property === 'transition-duration' && !namesProperty ? ['all'] : []
  if (bad.length > 0) return ['css/animated-property', `Transitions may animate only transform, opacity and filter, not ${bad.join(', ')}; name them in transition-property.`]
  if (property === 'z-index') {
    const only = decl.value.type === 'Value' && decl.value.children.size === 1 ? decl.value.children.first : null
    const fine = only?.type === 'Identifier' ? plain(only.name) === 'auto' : only?.type === 'Number' && /^-?\d+$/.test(only.value) && Number(only.value) <= maxThemeZIndex
    if (!fine) return ['css/z-index', `z-index must be a whole number no higher than ${maxThemeZIndex}, so core's parts stay on top.`]
  }
  const words = (n: CssNode) => (n.type === 'String' && n.value !== '') || (n.type === 'Function' && plain(n.name) === 'var')
  if (textProperties.has(property) && find(decl.value, words) !== null) {
    return ['css/text', `CSS ${property} may not hold words; shoppers' words come from content/{language}/*.json.`]
  }
  if (property === 'composes' && find(decl.value, (n) => n.type === 'Identifier' && plain(n.name) === 'from') !== null) {
    return ['css/composes', "composes may name only this module's own classes, never another file's or a global one."]
  }
  return undefined
}

const startsWithClass = (selector: Selector) => selector.children.first?.type === 'ClassSelector'

/** The CSS Module rules of ARCHITECTURE §3.4 for one file. */
export const checkCss = (file: string, text: string, context: GuardContext): Problem[] => {
  const problems: Problem[] = []
  const report = (node: CssNode | null, rule: RuleId, message: string) => problems.push(problem(file, node?.loc?.start.line ?? 1, rule, message))
  const media = new Set(context.mediaIds)
  let ast: CssNode
  try {
    ast = parse(text, {
      positions: true,
      parseCustomProperty: true,
      onParseError: (error) => problems.push(problem(file, typeof error.line === 'number' ? error.line : 1, 'css/unreadable', `This CSS can't be read: ${error.message}.`)),
    })
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return [problem(file, 1, 'css/unreadable', "This CSS can't be read: it nests too deeply.")]
  }
  walk(ast, function (this: WalkContext, node: CssNode) {
    const inKeyframes = this.atrule !== null && plain(this.atrule.name) === 'keyframes'
    switch (node.type) {
      case 'Raw':
        // Nested rules, and anything else css-tree leaves unread but a plain name such as ::part(price), are refused unchecked.
        if (this.function === null ? node.value.trim() !== '' : !/^[\s\w-]*$/.test(node.value)) {
          report(node, 'css/unreadable', "This CSS can't be read: write each rule out on its own, without nesting or escapes.")
        }
        break
      case 'Atrule':
        if (!atRules.has(plain(node.name))) report(node, 'css/at-rule-not-allowed', `@${node.name} isn't allowed in a theme; use only @media, @supports, @container and @keyframes (fonts come from core).`)
        break
      case 'Selector':
        if (!inKeyframes && this.function === null && !startsWithClass(node)) report(node, 'css/selector-not-scoped', 'Every selector must start with a class of this CSS Module, such as .card h2.')
        break
      case 'PseudoClassSelector': {
        const name = plain(node.name)
        if (name === 'global' || name === 'local') {
          report(node, 'css/global', `:${name} is never allowed; style only this module's own classes.`)
          return walk.skip
        }
        if (!pseudoClasses.has(name)) report(node, 'css/pseudo-not-allowed', `:${node.name} isn't allowed in a theme.`)
        break
      }
      case 'PseudoElementSelector':
        if (!pseudoElements.has(plain(node.name))) report(node, 'css/pseudo-not-allowed', `::${node.name} isn't allowed in a theme.`)
        break
      case 'Url':
        if (!media.has(node.value)) report(node, 'css/url-not-media', `url() may name only one of the store's media ids, not "${node.value}".`)
        break
      case 'Function':
        if (!functions.has(plain(node.name))) report(node, 'css/function-not-allowed', `${node.name}() isn't allowed in a theme's CSS.`)
        break
      case 'Declaration': {
        const found = declarationProblem(node, inKeyframes, this.block?.children.toArray() ?? [])
        if (found) report(node, found[0], found[1])
        break
      }
      default:
        if (namesCore(node)) report(node, 'css/core-selector', "Theme CSS may not name core's classes or df- elements, or select by class or id attribute; style core's parts through their documented properties and ::part.")
    }
  })
  return problems
}
