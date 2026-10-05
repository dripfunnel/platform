import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import type { CollectionSummary } from '../../api/collections'
import { mergeValues, saveFilter, type Filter } from '../../api/filters'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.collections.filters

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

const refusalOf = (error: unknown): string => (isApiError(error) ? ((words.refused as Record<string, string>)[error.code] ?? words.refused.other) : words.refused.other)

/** Values that differ only by case, spaces or punctuation ("Off-white", "Off white"): the first is kept. */
export const lookAlikes = (values: readonly { id: string; name: string }[]): { id: string; name: string }[] | null => {
  const groups = new Map<string, { id: string; name: string }[]>()
  for (const v of values) {
    const key = v.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    groups.set(key, [...(groups.get(key) ?? []), v])
  }
  return [...groups.values()].find((g) => g.length > 1) ?? null
}

/** How many collections' rules name one of this filter's values. */
const usedBy = (filter: Filter, collections: readonly CollectionSummary[]) => {
  const ids = new Set(filter.values.map((v) => v.id))
  return collections.filter((c) => c.rules.some((r) => r.valueId !== null && ids.has(r.valueId))).length
}

export interface FiltersTabProps {
  filters: readonly Filter[]
  collections: readonly CollectionSummary[]
  canEdit: boolean
  onChanged: (toast: string) => void
}

/** CatCollections › Filters: each filter with its values and counts, shopper-facing or internal, and the explainer beside. */
export const FiltersTab = ({ filters, collections, canEdit, onChanged }: FiltersTabProps) => {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      onChanged(await work())
    } catch (error) {
      onChanged(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  const write = (f: Filter, patch: Partial<Pick<Filter, 'shopperVisible'>> & { values?: { id: string | null; name: string }[] }) =>
    saveFilter({ id: f.id, name: f.name, position: f.position, shopperVisible: patch.shopperVisible ?? f.shopperVisible, values: patch.values ?? f.values.map((v) => ({ id: v.id, name: v.name })) })

  const create = () =>
    setAsk({
      title: words.newTitle,
      target: '',
      consequence: words.newBody,
      confirmLabel: words.newConfirm,
      input: { label: words.newName, type: 'text', initial: '', placeholder: words.newPlaceholder, error: (v) => (v.trim() === '' ? words.newMissing : null) },
      onConfirm: (_, value) => {
        const name = (value ?? '').trim()
        void run(async () => {
          await saveFilter({ id: null, name, position: Math.max(-1, ...filters.map((f) => f.position)) + 1, shopperVisible: true, values: [] })
          return fill(words.created, { name })
        })
      },
    })

  const addValue = (f: Filter) =>
    setAsk({
      title: fill(words.addTitle, { name: f.name }),
      target: f.name,
      consequence: '',
      confirmLabel: words.addConfirm,
      input: { label: words.addValue, type: 'text', initial: '', placeholder: words.addPlaceholder, error: (v) => (v.trim() === '' ? words.addMissing : null) },
      onConfirm: (_, value) => {
        const name = (value ?? '').trim()
        void run(async () => {
          await write(f, { values: [...f.values.map((v) => ({ id: v.id, name: v.name })), { id: null, name }] })
          return fill(words.added, { value: name })
        })
      },
    })

  const rename = (f: Filter, v: Filter['values'][number]) =>
    setAsk({
      title: fill(words.renameTitle, { value: v.name }),
      target: v.name,
      consequence: v.products === 0 ? words.usesNone : fill(plural(words.uses, v.products), { count: formatCount(v.products) }),
      confirmLabel: words.renameConfirm,
      input: { label: words.renameTo, type: 'text', initial: v.name, error: (next) => (next.trim() === '' ? words.renameMissing : null) },
      onConfirm: (_, value) => {
        const name = (value ?? '').trim()
        if (name === v.name) return
        void run(async () => {
          await write(f, { values: f.values.map((x) => ({ id: x.id, name: x.id === v.id ? name : x.name })) })
          return fill(plural(words.renamed, v.products), { value: name, count: formatCount(v.products) })
        })
      },
    })

  const remove = (f: Filter, v: Filter['values'][number]) =>
    setAsk({
      title: fill(words.deleteTitle, { value: v.name }),
      target: v.name,
      consequence: v.products === 0 ? words.deleteNone : fill(plural(words.deleteBody, v.products), { count: formatCount(v.products) }),
      confirmLabel: words.deleteConfirm,
      danger: true,
      onConfirm: () =>
        void run(async () => {
          await write(f, { values: f.values.filter((x) => x.id !== v.id).map((x) => ({ id: x.id, name: x.name })) })
          return fill(words.deleted, { value: v.name })
        }),
    })

  const manage = (f: Filter, v: Filter['values'][number]) =>
    setAsk({
      title: fill(words.manageTitle, { value: v.name, name: f.name }),
      target: v.name,
      consequence: v.products === 0 ? words.usesNone : fill(plural(words.uses, v.products), { count: formatCount(v.products) }),
      confirmLabel: words.next,
      choices: [{ key: 'what', label: fill(words.choose, { value: v.name }), options: [{ value: 'rename', label: words.rename }, { value: 'delete', label: words.delete }], initial: 'rename', error: () => null }],
      onConfirm: (_, __, picks) => (picks['what'] === 'delete' ? remove(f, v) : rename(f, v)),
    })

  const merge = (f: Filter, group: { id: string; name: string }[]) => {
    const [keep, ...drop] = group
    if (!keep) return
    const count = f.values.filter((v) => drop.some((d) => d.id === v.id)).reduce((n, v) => n + v.products, 0)
    const named = drop.map((d) => `“${d.name}”`).join(', ')
    setAsk({
      title: fill(words.mergeTitle, { keep: keep.name }),
      target: keep.name,
      consequence: fill(plural(words.mergeBody, count), { count: formatCount(count), drop: named, keep: keep.name }),
      confirmLabel: words.mergeConfirm,
      onConfirm: () =>
        void run(async () => {
          await mergeValues(
            keep.id,
            drop.map((d) => d.id),
          )
          return fill(plural(words.merged, count), { count: formatCount(count), keep: keep.name })
        }),
    })
  }

  return (
    <div className="df-coll-edit">
      <div className="df-coll-edit-main">
        <div className="df-colls-head">
          <div>
            <h1 className="df-page-title">{words.title}</h1>
            <p className="df-page-lede">{words.sub}</p>
          </div>
          {canEdit && (
            <button type="button" className="df-button df-button--primary" disabled={busy} onClick={create}>
              {words.create}
            </button>
          )}
        </div>
        {filters.length === 0 && <p className="df-colls-note">{words.none}</p>}
        {filters.map((f) => {
          const used = usedBy(f, collections)
          const alike = lookAlikes(f.values)
          return (
            <section key={f.id} className={f.shopperVisible ? 'df-filter' : 'df-filter df-filter--internal'} aria-label={f.name}>
              <div className="df-filter-head">
                <h2>{f.name}</h2>
                <span>
                  <button
                    type="button"
                    className={f.shopperVisible ? 'df-filter-tag' : 'df-filter-tag df-filter-tag--internal'}
                    disabled={!canEdit || busy}
                    aria-label={fill(f.shopperVisible ? words.makeInternal : words.makeShopper, { name: f.name })}
                    onClick={() => void run(async () => (await write(f, { shopperVisible: !f.shopperVisible }), fill(f.shopperVisible ? words.nowInternal : words.nowShopper, { name: f.name })))}
                  >
                    {f.shopperVisible ? words.shopper : words.internal}
                  </button>
                  {used > 0 && <span className="df-coll-hint">{fill(plural(words.usedBy, used), { count: formatCount(used) })}</span>}
                </span>
              </div>
              <div className="df-filter-values">
                {f.values.length === 0 && <span className="df-coll-hint">{words.noValues}</span>}
                {f.values.map((v) => (
                  <button key={v.id} type="button" className={alike?.some((a) => a.id === v.id) ? 'df-filter-value df-filter-value--alike' : 'df-filter-value'} disabled={!canEdit || busy} onClick={() => manage(f, v)}>
                    {v.name} <span>{formatCount(v.products)}</span>
                  </button>
                ))}
                {canEdit && (
                  <button type="button" className="df-filter-add" disabled={busy} aria-label={fill(words.addLabel, { name: f.name })} onClick={() => addValue(f)}>
                    {words.add}
                  </button>
                )}
              </div>
              {alike && alike[0] && alike[1] && (
                <div className="df-filter-alike">
                  <span>{fill(words.lookAlike, { a: alike[0].name, b: alike[1].name })}</span>
                  {canEdit && (
                    <button type="button" disabled={busy} onClick={() => merge(f, alike)}>
                      {words.merge}
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
      <aside className="df-coll-preview df-filter-explain" aria-labelledby="df-filter-explain">
        <h2 id="df-filter-explain">{words.explainTitle}</h2>
        <p>
          <strong className="df-filter-choices">{words.choicesLabel}</strong> — {words.choices}
        </p>
        <p>
          <strong className="df-filter-filters">{words.filtersLabel}</strong> — {words.filtersText}
        </p>
        <p>
          <strong>{words.tagsLabel}</strong> — {words.tags}
        </p>
        <span className="df-coll-hint">{words.tip}</span>
      </aside>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
