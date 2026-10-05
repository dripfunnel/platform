import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { loadProductBasics, type ProductBasics } from '../../api/productEditor'
import { badgeRules, deleteBadge, saveBadge, saveSections, sectionKeys, type BadgeRule, type SectionKey } from '../../api/settings'
import { fill, messages } from '../../messages'
import { refusalIn } from '../common/refusal'

const words = messages.settings.catalogue

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>
type Sections = Record<SectionKey, boolean>

/** "What do you mostly sell?": the sections each kind of shop usually wants (CatSettings' presets). */
export const presets: Record<keyof typeof words.presets, Partial<Sections>> = {
  clothing: { sizeCharts: true, specs: true, highlights: true, badges: true },
  electronics: { specs: true, highlights: true, faqs: true, related: true, sizeCharts: false },
  food: { highlights: true, faqs: true, sizeCharts: false, specs: true },
  beauty: { highlights: true, faqs: true, sizeCharts: false },
  handmade: { badges: true, highlights: true, sizeCharts: false },
}

/** A badge's colour follows what it says, as in the prototype; the API holds three. */
const toneOf = (rule: BadgeRule): 'ok' | 'peach' | 'neutral' => (rule === 'new_30_days' ? 'ok' : rule === 'manual' ? 'neutral' : 'peach')

const refusalOf = refusalIn(words.refused)

/** A section the plan no longer has reads as off, as the server treats it: a save never sends it on (P5). */
const isKnown = (rule: string): rule is BadgeRule => (badgeRules as readonly string[]).includes(rule)

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
  const [preset, setPreset] = useState<keyof typeof presets | null>(null)
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

  const choose = (k: keyof typeof presets) => {
    setPreset(k)
    setSections((s) => Object.fromEntries(sectionKeys.map((key) => [key, (presets[k][key] ?? s[key]) && inPlan(key)])) as Sections)
    onSaved(fill(words.presetApplied, { name: words.presets[k] }))
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
        <div className="df-team-chips" role="group" aria-labelledby={`${id}-sell`}>
          {(Object.keys(presets) as (keyof typeof presets)[]).map((k) => (
            <button key={k} type="button" aria-pressed={preset === k} disabled={ro} onClick={() => choose(k)}>
              {words.presets[k]}
            </button>
          ))}
        </div>
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
                <button type="button" role="switch" aria-checked={allowed && sections[k]} aria-label={words.sections[k]} className="df-set-switch" disabled={ro || !allowed} onClick={() => setSections({ ...sections, [k]: !sections[k] })}>
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
