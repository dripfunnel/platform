import { subdomainFrom, type Country } from '../../api/auth'
import { fill, messages } from '../../messages'
import { Field } from './fields'

const su3 = messages.auth.signup.su3

export interface StoreDraft {
  store: string
  subdomain: string
  /** Once the address is typed, it stops following the store's name. */
  subTouched: boolean
  country: string
}

export const emptyStoreDraft: StoreDraft = { store: '', subdomain: '', subTouched: false, country: '' }

export const draftSubdomain = (draft: StoreDraft): string => draft.subdomain || subdomainFrom(draft.store)

/** su3's own checks before the API's; null when the draft can be sent. */
export const storeDraftProblem = (draft: StoreDraft): string | null => {
  if (!draft.store.trim()) return su3.nameMissing
  if (!draftSubdomain(draft)) return su3.subBad
  if (!draft.country) return su3.countryNone
  return null
}

// PortalAuth su3's fields, for sign-up and for Create another store (#1136).
export const StoreFields = ({ draft, onDraft, countries, shopDomain }: { draft: StoreDraft; onDraft: (next: StoreDraft) => void; countries: readonly Country[]; shopDomain: string | null }) => (
  <>
    <Field
      label={su3.store}
      placeholder={su3.storePlaceholder}
      value={draft.store}
      onValue={(store) => onDraft({ ...draft, store, subdomain: draft.subTouched ? draft.subdomain : subdomainFrom(store) })}
      help={su3.storeHelp}
    />
    <Field
      label={su3.sub2}
      placeholder={su3.subPlaceholder}
      value={draft.subdomain}
      onValue={(value) => onDraft({ ...draft, subTouched: true, subdomain: value.toLowerCase() })}
      help={shopDomain && draft.subdomain ? fill(su3.subHelp, { address: `${draft.subdomain}.${shopDomain}` }) : su3.subHelpNone}
    />
    <div className="df-auth-field">
      <label className="df-auth-label" htmlFor="signup-country">
        {su3.country}
      </label>
      <span className="df-auth-control">
        <select id="signup-country" value={draft.country} onChange={(event) => onDraft({ ...draft, country: event.target.value })}>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} · {c.currency}
            </option>
          ))}
        </select>
      </span>
      <span className="df-auth-help">{su3.countryHelp}</span>
    </div>
  </>
)
