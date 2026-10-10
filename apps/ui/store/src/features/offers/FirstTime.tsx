import { Link } from '@tanstack/react-router'
import { offerKinds } from '../../api/offers'
import { harnessSearch } from '../../harness'
import { fill, messages } from '../../messages'
import type { Recipe } from './offerDraft'

// A store with no offers yet (A1): one line of explanation, the four kinds of offer, and three recipes.

const words = messages.offers
const firstRecipes: Recipe[] = ['welcome', 'freeShipping', 'seasonal']

export const FirstTime = ({ ship }: { ship: string }) => (
  <section className="df-offers-first" aria-labelledby="df-offers-first">
    <div>
      <h2 id="df-offers-first">{words.firstTime.heading}</h2>
      <p className="df-offers-sub">{fill(words.firstTime.body, { ship })}</p>
    </div>
    <div className="df-offer-types">
      {offerKinds.map((k) => (
        <Link key={k} className="df-offer-type" to="/offers/new" search={(prev) => ({ ...harnessSearch(prev), type: k })}>
          <span className={`df-offer-glyph df-offer-glyph--${k}`} aria-hidden="true">
            {{ products: '%', order: '−', bxgy: '2+1', shipping: '⇢' }[k]}
          </span>
          <strong>{fill(words.kinds[k], { ship })}</strong>
          <span className="df-offers-sub">{fill(words.editor.examples[k], { ship })}</span>
        </Link>
      ))}
    </div>
    <span className="df-eyebrow">{words.firstTime.recipes}</span>
    <div className="df-offer-recipes-row">
      {firstRecipes.map((r) => (
        <Link key={r} className="df-offer-recipe" to="/offers/new" search={(prev) => ({ ...harnessSearch(prev), recipe: r })}>
          <strong>{fill(r === 'seasonal' ? words.editor.recipes.sale.title : words.editor.recipes[r].title, { ship })}</strong>
          <span className="df-offers-sub">{r === 'seasonal' ? words.editor.recipes.sale.body : words.editor.recipes[r].body}</span>
        </Link>
      ))}
    </div>
  </section>
)
