// What a theme may animate, in CSS and in motion (storefront ARCHITECTURE §3.4 "CSS"; #1245): none moves layout (§9).
export const animatedProperties: ReadonlySet<string> = new Set([
  ...['transform', 'translate', 'scale', 'rotate', 'opacity', 'filter'],
  ...['color', 'background', 'background-color', 'background-position', 'background-size', 'border-color', 'outline-color', 'text-decoration-color'],
  ...['box-shadow', 'text-shadow', 'clip-path', 'mask-position', 'mask-size', 'fill', 'stroke', 'stroke-dashoffset'],
])

const camel = (property: string) => property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
const kebab = (property: string) => property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

// motion's own transform names, and its path drawing, which it writes as stroke-dasharray and stroke-dashoffset.
const motionTransforms = ['x', 'y', 'z', 'scaleX', 'scaleY', 'rotateX', 'rotateY', 'rotateZ', 'skew', 'skewX', 'skewY', 'translateX', 'translateY', 'translateZ', 'pathLength', 'pathOffset']
export const motionProperties: ReadonlySet<string> = new Set([...[...animatedProperties].map(camel), ...motionTransforms])

const layout = /^(?:(?:min-|max-)?(?:width|height)|top|left|right|bottom|inset(?:-.+)?|margin(?:-.+)?|padding(?:-.+)?|(?:row-|column-)?gap|font-size|line-height|letter-spacing|grid-template(?:-.+)?|grid-auto-(?:rows|columns))$/

/** Why a theme may not animate these names; motion's are written in camelCase. */
export const animationAdvice = (names: readonly string[]): string => {
  const moves = names.filter((n) => layout.test(kebab(n)))
  const others = names.filter((n) => !moves.includes(n))
  return [
    'animate only transform, opacity, filter, colours, shadows, clip-path, masks and SVG fill and stroke',
    ...(moves.length > 0 ? [`not ${moves.join(', ')}, which moves layout and stutters on phones: get the same look with transform or clip-path`] : []),
    ...(others.length > 0 ? [`not ${others.join(', ')}`] : []),
  ].join('; ')
}
