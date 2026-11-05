/**
 * Core's reduced-motion rule, first in every theme's stylesheet (storefront ARCHITECTURE §3.4 "CSS"; #1245): a CSS
 * animation, a scroll timeline or a transition ends at once. Its layer comes first, so no theme's !important outranks it.
 */
export const reducedMotionCss = `@layer df-reduced-motion {
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 0.01ms !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      animation-timeline: auto !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      scroll-behavior: auto !important;
    }
  }
}
`
