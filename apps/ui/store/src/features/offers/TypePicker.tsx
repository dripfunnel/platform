import { offerKinds, type OfferKind } from '../../api/offers'
import { fill, messages } from '../../messages'
import { recipes, type Recipe } from './offerDraft'

// "What kind of offer?" (OfferEditor's first screen, §5 principle 1): four outcomes with an everyday example, and the
// recipes (V) that fill the form for the merchant to adjust.

const words = messages.offers.editor

const glyph: Record<OfferKind, string> = { products: '%', order: '−', bxgy: '2+1', shipping: '⇢' }

export const TypePicker = ({ ship, season, onPick }: { ship: string; season: string | null; onPick: (type: OfferKind, recipe: Recipe | null) => void }) => (
  <div className="df-offer-picking">
    <div>
      <h1 className="df-page-title">{words.pickTitle}</h1>
      <p className="df-page-lede">{words.pickLede}</p>
    </div>
    <div className="df-offer-types">
      {offerKinds.map((k) => (
        <button key={k} type="button" className="df-offer-type" onClick={() => onPick(k, null)}>
          <span className={`df-offer-glyph df-offer-glyph--${k}`} aria-hidden="true">
            {glyph[k]}
          </span>
          <strong>{fill(messages.offers.kinds[k], { ship })}</strong>
          <span className="df-offers-sub">{fill(words.examples[k], { ship })}</span>
        </button>
      ))}
    </div>
    <div className="df-offer-recipes">
      <h2>{words.recipesTitle}</h2>
      <span className="df-offers-sub">{words.recipesLede}</span>
      <div>
        {recipes.map((r) => (
          <button key={r} type="button" className="df-offer-recipe" onClick={() => onPick('order', r)}>
            <strong>{r === 'seasonal' && season ? fill(words.recipes.seasonal.title, { season }) : fill(r === 'seasonal' ? words.recipes.sale.title : words.recipes[r].title, { ship })}</strong>
            <span className="df-offers-sub">{r === 'seasonal' && !season ? words.recipes.sale.body : words.recipes[r].body}</span>
          </button>
        ))}
      </div>
    </div>
  </div>
)
