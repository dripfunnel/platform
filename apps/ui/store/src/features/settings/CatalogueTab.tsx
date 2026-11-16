import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { loadProductBasics, type ProductBasics } from '../../api/productEditor'
import { badgeRules, deleteBadge, saveBadge, saveSections, sectionKeys, type BadgeRule, type SectionKey } from '../../api/settings'
import { chooseShopCategory, loadShopCategory, type ShopCategoryChoice } from '../../api/shopCategory'
import { fill, locale, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { SearchSelect } from '../common/SearchSelect'
import '../common/switch.css'

const words = messages.settings.catalogue

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>
type Sections = Record<SectionKey, boolean>


/** A badge's colour follows what it says, as in the prototype; the API holds three. */
const toneOf = (rule: BadgeRule): 'ok' | 'peach' | 'neutral' => (rule === 'new_30_days' ? 'ok' : rule === 'manual' ? 'neutral' : 'peach')

const refusalOf = refusalIn(words.refused)

const isKnown = (rule: string): rule is BadgeRule => (badgeRules as readonly string[]).includes(rule)

/** A section the plan no longer has reads as off, as the server treats it: a save never sends it on (P5). */
const sectionsOf = (basics: ProductBasics): Sections =>
  Object.fromEntries(sectionKeys.map((k) => {
    const f = basics.features.find((x) => x.key === k)
    return [k, (f?.enabled ?? false) && f?.inPlan !== false]
  })) as Sections

export interface CatalogueTabProps {
  basics: ProductBasics
  planName: string | null
  owner: boolean
  canEdit: boolean
  onSaved: (toast: string) => void
}

/** CatSettings' catalogue tab: the sections products show, by plan, and the store's badges. */
export const CatalogueTab = ({ basics, planName, owner, canEdit, onSaved }: CatalogueTabProps) => {
  const id = useId()
  const [saved, setSaved] = useState<Sections>(() => sectionsOf(basics))
  const [sections, setSections] = useState<Sections>(saved)
  // What the shop sells (DATA-MODEL §7.2); null while it loads, or when the read is refused.
  const [category, setCategory] = useState<ShopCategoryChoice | null>(null)
  useEffect(() => {
    let live = true
    loadShopCategory().then((c) => live && setCategory(c), () => undefined)
    return () => {
      live = false
    }
  }, [])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  // Badges read again on their own after a change, so switches not yet saved stay as they are.
  const [badges, setBadges] = useState(basics.badges)
  const reread = async (toast: string) => {
    // The badge is saved either way; a list that didn't come back stays as it was rather than saying the save failed.
    await loadProductBasics().then((b) => setBadges(b.badges), () => undefined)
    return toast
  }
  const inPlan = (k: SectionKey) => basics.features.find((f) => f.key === k)?.inPlan !== false
  const ro = !canEdit || busy
  const dirty = JSON.stringify(sections) !== JSON.stringify(saved)

  const run = async (work: () => Promise<string>, after: (toast: string) => void) => {
    setBusy(true)
    setFailure(null)
    try {
      after(await work())
    } catch (error) {
      setFailure(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  const chooseCategory = (id: string) =>
    void run(async () => {
      const current = await chooseShopCategory(id)
      setCategory((c) => (c ? { ...c, current } : c))
      return fill(words.categorySaved, { name: current.name })
    }, onSaved)

  // The category's sections that are in the plan and still off: offered, never forced, and never switching one off.
  const suggested = (category?.current?.sections ?? []).filter((k) => inPlan(k) && !sections[k])
  const switchOnSuggested = () => {
    setSections((s) => ({ ...s, ...Object.fromEntries(suggested.map((k) => [k, true])) }))
    onSaved(fill(words.suggestedOn, { name: category?.current?.name ?? '' }))
  }

  const saveAll = () =>
    void run(
      async () => {
        await saveSections(sectionKeys.map((key) => ({ key, enabled: sections[key] })))
        setSaved(sections)
        return words.sectionsSaved
      },
      onSaved,
    )

  const editBadge = (b: ProductBasics['badges'][number] | null) =>
    setAsk({
      title: b ? fill(words.editBadge, { name: b.label }) : words.addBadge,
      target: '',
      consequence: words.badgeBody,
      confirmLabel: words.saveBadge,
      input: { label: words.badgeText, type: 'text', initial: b?.label ?? '', placeholder: words.badgePlaceholder, error: (v) => (v.trim() === '' ? words.badgeMissing : v.trim().length > 18 ? words.badgeLong : null) },
      choices: [
        {
          key: 'rule',
          label: words.when,
          // A rule this screen doesn't know (one the API added since) is offered as itself, so editing the text keeps it.
          options: [...(b && !isKnown(b.rule) ? [{ value: b.rule, label: words.ruleKept }] : []), ...badgeRules.map((r) => ({ value: r, label: words.ruleOptions[r] }))],
          initial: b?.rule ?? 'manual',
          error: () => null,
        },
      ],
      onConfirm: (_, value, picks) => {
        const known = badgeRules.find((r) => r === picks['rule'])
        const rule = known ?? (b && picks['rule'] === b.rule ? b.rule : 'manual')
        const label = (value ?? '').trim()
        void run(async () => (await saveBadge(b?.id ?? null, { label, rule, tone: known ? toneOf(known) : (b?.tone ?? 'neutral'), position: b ? b.position : badges.reduce((n, x) => Math.max(n, x.position + 1), 0) }), reread(b ? words.badgeSaved : fill(known === 'manual' ? words.badgeAddedManual : words.badgeAddedAuto, { name: label }))), onSaved)
      },
    })

  const removeBadge = (b: ProductBasics['badges'][number]) =>
    setAsk({
      title: fill(words.deleteBadgeTitle, { name: b.label }),
      target: b.label,
      consequence: words.deleteBadgeBody,
      confirmLabel: words.delete,
      danger: true,
      onConfirm: () => void run(async () => (await deleteBadge(b.id), reread(words.badgeDeleted)), onSaved),
    })

  return (
    <div className="df-set-store">
      {failure && (
        <p className="df-set-failure" role="alert">
          {failure}
        </p>
      )}
      <section className="df-set-card" aria-labelledby={`${id}-sell`}>
        <h2 id={`${id}-sell`}>{words.sellTitle}</h2>
        <p className="df-set-lede">{words.sellSub}</p>
        {category && (
          <div className="df-cat-sell">
            <SearchSelect
              labelledBy={`${id}-sell`}
              options={category.options.filter((o) => !o.archived || o.id === category.current?.id).map((o) => ({ id: o.id, label: o.name }))}
              value={category.current?.id ?? null}
              onChange={chooseCategory}
              placeholder={words.categoryPlaceholder}
              noMatches={words.categoryNoMatches}
              disabled={ro}
            />
          </div>
        )}
        {category?.current && suggested.length > 0 && canEdit && (
          <div className="df-cat-suggest" role="status">
            <span>{fill(words.suggested, { name: category.current.name, sections: new Intl.ListFormat(locale, { type: 'conjunction' }).format(suggested.map((k) => words.sections[k])) })}</span>
            <button type="button" className="df-button" disabled={ro} onClick={switchOnSuggested}>
              {words.switchOn}
            </button>
          </div>
        )}
      </section>

      <section className="df-set-card df-cat-sections" aria-labelledby={`${id}-sections`}>
        <div className="df-set-foot">
          <h2 id={`${id}-sections`}>{words.sectionsTitle}</h2>
          {planName && <span className="df-set-help">{fill(words.yourPlan, { plan: planName })}</span>}
        </div>
        <ul className="df-cat-list">
          {sectionKeys.map((k) => {
            const allowed = inPlan(k)
            return (
              <li key={k}>
                <span className="df-cat-text">
                  <strong>{words.sections[k]}</strong>
                  <span>{words.sectionHelp[k]}</span>
                </span>
                {allowed ? (
                  <span className="df-set-help">{words.included}</span>
                ) : owner ? (
                  <Link to="/billing" className="df-set-link">
                    {words.seePlans}
                  </Link>
                ) : (
                  <span className="df-set-help">{words.askOwner}</span>
                )}
                <button type="button" role="switch" aria-checked={allowed && sections[k]} aria-label={words.sections[k]} className="df-switch" disabled={ro || !allowed} onClick={() => setSections({ ...sections, [k]: !sections[k] })}>
                  <span aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
        <div className="df-set-foot">
          <span className="df-set-help">{words.offKeeps}</span>
          {canEdit && (
            <button type="button" className="df-button df-button--primary" disabled={busy || !dirty} onClick={saveAll}>
              {words.saveSections}
            </button>
          )}
        </div>
      </section>

      {saved.badges && inPlan('badges') && (
        <section className="df-set-card" aria-labelledby={`${id}-badges`}>
          <div className="df-set-foot">
            <h2 id={`${id}-badges`}>{words.badgesTitle}</h2>
            {canEdit && (
              <button type="button" className="df-button df-button--small" disabled={busy} onClick={() => editBadge(null)}>
                {words.addBadge}
              </button>
            )}
          </div>
          <p className="df-set-lede">{words.badgesSub}</p>
          {badges.length === 0 ? (
            <p className="df-set-help">{words.noBadges}</p>
          ) : (
            <ul className="df-cat-list">
              {badges.map((b) => {
                const rule = isKnown(b.rule) ? b.rule : null
                return (
                  <li key={b.id}>
                    <span className={`df-cat-badge df-cat-badge--${rule ? toneOf(rule) : b.tone}`}>{b.label}</span>
                    <span className="df-cat-text">
                      <span>{rule ? words.rules[rule] : words.ruleOther}</span>
                    </span>
                    {canEdit && (
                      <span className="df-cat-badge-tools">
                        <button type="button" className="df-set-link" disabled={busy} aria-label={fill(words.editBadge, { name: b.label })} onClick={() => editBadge(b)}>
                          {words.edit}
                        </button>
                        <button type="button" className="df-set-link" disabled={busy} aria-label={fill(words.deleteBadgeTitle, { name: b.label })} onClick={() => removeBadge(b)}>
                          {words.delete}
                        </button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
