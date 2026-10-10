import { sealedCss } from './styles'

/** Core's sealed components (storefront ARCHITECTURE §2.1 `sealed`, §3.5), by the name ./testing and the reports use. */
export const sealedParts = ['price', 'preview', 'powered', 'legal', 'consent', 'consent-settings', 'breadcrumbs'] as const
export type SealedPart = (typeof sealedParts)[number]

export const sealedTag = 'df-sealed'

const roots = new WeakMap<Element, ShadowRoot>()
const sheets = new Map<SealedPart, CSSStyleSheet>()

const attach = (host: HTMLElement): ShadowRoot => {
  const root = host.attachShadow({ mode: 'closed' })
  // The server-rendered words show through until core renders inside, then nothing is slotted.
  root.append(host.ownerDocument.createElement('slot'))
  roots.set(host, root)
  return root
}

/** Registers `<df-sealed>`, whose closed root only core holds. */
export const defineSealed = () => {
  if (typeof customElements === 'undefined' || customElements.get(sealedTag)) return
  customElements.define(
    sealedTag,
    class extends HTMLElement {
      constructor() {
        super()
        attach(this)
      }
    },
  )
}

/** The closed root core renders a sealed component into, with its locked styles; never handed to a theme. */
export const sealedRoot = (host: HTMLElement, part: SealedPart): ShadowRoot => {
  const root = roots.get(host) ?? attach(host)
  if (root.adoptedStyleSheets.length === 0) {
    let sheet = sheets.get(part)
    if (!sheet) {
      sheet = new CSSStyleSheet()
      sheet.replaceSync(sealedCss(part))
      sheets.set(part, sheet)
    }
    root.adoptedStyleSheets = [sheet]
  }
  return root
}

export const rootOf = (host: Element): ShadowRoot | undefined => roots.get(host)

/** Every sealed component on the page; `shown` is false while one deliberately isn't, such as an answered consent banner. */
export const sealedOnPage = (doc: Document): { host: HTMLElement; part: SealedPart; shown: boolean }[] =>
  [...doc.querySelectorAll<HTMLElement>(`${sealedTag}[data-df-sealed]`)].flatMap((host) => {
    const part = sealedParts.find((p) => p === host.dataset.dfSealed)
    return part ? [{ host, part, shown: host.dataset.dfState !== 'closed' }] : []
  })

/** The focused element, inside sealed components too, so focus can go back to a button in one. */
export const focusedElement = (doc: Document): Element | null => {
  let el = doc.activeElement
  for (let inner = el && rootOf(el)?.activeElement; inner; inner = rootOf(inner)?.activeElement) el = inner
  return el
}

/** Puts a banner in the browser's top layer, where no z-index can cover it. */
export const showInTopLayer = (el: HTMLElement | null) => {
  if (!el || typeof el.showPopover !== 'function') return
  try {
    if (!el.matches(':popover-open')) el.showPopover()
  } catch {
    // A browser without popover support shows the banner in place instead.
  }
}
