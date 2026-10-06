import { Link } from '@tanstack/react-router'
import { fill, formatCount, messages } from '../../messages'

const words = messages.products.empty

// The checklist marks only what this screen knows: a new store has no products. The rest stay "Set up"
// until their own screens report back (FIRST-RELEASE §11).
const steps = [
  { label: words.storeDetails, cta: words.setUp, to: '/settings' },
  { label: words.addThree, cta: fill(words.addThreeCta, { done: formatCount(0) }), to: '/products/$productId' },
  { label: words.collection, cta: words.create, to: '/collections' },
  { label: words.shipping, cta: words.setUp, to: '/settings' },
] as const

/** A new store's first product: the hero and "Get your shop ready" (CatList, isEmpty). */
export const ProductsEmpty = ({ canAdd, canImport }: { canAdd: boolean; canImport: boolean }) => (
  <div className="df-products-empty">
    <section className="df-products-hero">
      <h2>{words.title}</h2>
      <p>{words.body}</p>
      {(canAdd || canImport) && (
        <div className="df-products-hero-actions">
          {canAdd && (
            <Link className="df-button df-button--primary df-products-cta" to="/products/$productId" params={{ productId: 'new' }}>
              {words.add}
            </Link>
          )}
          {canImport && (
            <Link className="df-button df-products-cta" to="/products/import">
              {words.importFile}
            </Link>
          )}
        </div>
      )}
    </section>
    <section className="df-products-checklist" aria-labelledby="df-products-checklist">
      <div className="df-products-checklist-head">
        <h2 id="df-products-checklist">{words.checklist}</h2>
        <span>{fill(words.checkDone, { done: formatCount(0), count: formatCount(steps.length) })}</span>
      </div>
      <div className="df-products-progress" aria-hidden="true" />
      <ul>
        {steps.map((step) => (
          <li key={step.label}>
            {step.to === '/products/$productId' ? (
              <Link to={step.to} params={{ productId: 'new' }}>
                <span className="df-products-ring" aria-hidden="true" />
                <span>{step.label}</span>
                <span className="df-products-step-cta">{step.cta}</span>
              </Link>
            ) : (
              <Link to={step.to}>
                <span className="df-products-ring" aria-hidden="true" />
                <span>{step.label}</span>
                <span className="df-products-step-cta">{step.cta}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  </div>
)
