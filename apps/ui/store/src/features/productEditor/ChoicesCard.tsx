import type { ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { minorOf } from '@dripfunnel/shared/format'
import { useId, useState } from 'react'
import { fill, formatCount, messages, plural } from '../../messages'
import type { StockLevel, Warehouse } from '../../api/stock'
import { combinationsOf, maxOptions, maxVersions, newVersionCount, quantityOf, syncVersions, versionKey, type Draft, type DraftOption, type DraftProblem, type DraftVersion } from '../common/productDraft'
import { Card, type Update } from './EditorCards'
import { reservedLine, StockHistory, type StockHistoryView } from './StockCard'

/** The versions' stock at the default location, for a physical product (null otherwise). */
export interface VersionStock {
  warehouse: Warehouse | null
  canStock: boolean
  levels: ReadonlyMap<string, readonly StockLevel[]>
  history: StockHistoryView
  onHistory: () => void
  names: ReadonlyMap<string, string>
}

const words = messages.editor

export type Ask = (props: Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>) => void

const isColour = (name: string) => /colou?r/i.test(name)
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** One kind of choice with its values: renamed, moved up, its values added with Enter and removed with ×. */
const OptionRow = ({ draft, index, update, disabled, ask, onToast }: { draft: Draft; index: number; update: Update; disabled: boolean; ask: Ask; onToast: (text: string) => void }) => {
  const id = useId()
  const [typed, setTyped] = useState('')
  const option = draft.options[index]
  if (!option) return null
  const made = draft.versions.some((v) => v.id !== null || v.choices.length === draft.options.length)
  const setOption = (change: (o: DraftOption) => DraftOption) => update((d) => ({ ...d, options: d.options.map((o, i) => (i === index ? change(o) : o)) }))
  const addValue = () => {
    const name = typed.trim()
    if (!name) return
    if (option.values.some((v) => sameName(v.name, name))) return onToast(fill(words.choices.duplicate, { name }))
    setTyped('')
    setOption((o) => ({ ...o, values: [...o.values, { id: null, name: name.slice(0, 100) }] }))
  }
  const removeValue = (name: string) => {
    const gone = draft.versions.filter((v) => v.choices[index] !== undefined && sameName(v.choices[index] ?? '', name))
    const drop = () => update((d) => ({ ...d, options: d.options.map((o, i) => (i === index ? { ...o, values: o.values.filter((v) => v.name !== name) } : o)), versions: d.versions.filter((v) => !gone.includes(v)) }))
    if (gone.length === 0 || !made) return drop()
    ask({ title: fill(words.choices.removeValueTitle, { name }), target: option.name, consequence: fill(words.choices.removeValueBody, { count: formatCount(gone.length) }), confirmLabel: fill(words.choices.removeKind, { name }), danger: true, onConfirm: drop })
  }
  const removeOption = () => {
    // Versions merge: each combination left keeps its first version, as CatEditor's removal does.
    const merge = () =>
      update((d) => {
        const options = d.options.filter((_, i) => i !== index)
        const seen = new Map<string, DraftVersion>()
        for (const v of d.versions) {
          const choices = v.choices.filter((_, i) => i !== index)
          const key = choices.join('\u0000').toLowerCase()
          if (!seen.has(key)) seen.set(key, { ...v, choices })
        }
        return { ...d, options, versions: [...seen.values()] }
      })
    if (!made) return merge()
    ask({ title: fill(words.choices.removeKindTitle, { name: option.name }), target: option.name, consequence: words.choices.removeKindBody, confirmLabel: fill(words.choices.removeKind, { name: option.name }), danger: true, onConfirm: merge })
  }
  const moveUp = () =>
    update((d) => {
      const swap = <T,>(list: readonly T[]): T[] => {
        const out = [...list]
        const [a, b] = [out[index - 1], out[index]]
        if (a === undefined || b === undefined) return out
        out[index - 1] = b
        out[index] = a
        return out
      }
      return { ...d, options: swap(d.options), versions: d.versions.map((v) => (v.choices.length === d.options.length ? { ...v, choices: swap(v.choices) } : v)) }
    })
  return (
    <div className="df-editor-option">
      <div className="df-editor-option-head">
        <input aria-label={words.choices.kindName} value={option.name} maxLength={60} readOnly={disabled} onChange={(event) => setOption((o) => ({ ...o, name: event.target.value }))} />
        {!disabled && index > 0 && (
          <button type="button" className="df-editor-link" aria-label={fill(words.choices.moveUp, { name: option.name })} onClick={moveUp}>
            ↑
          </button>
        )}
        {!disabled && (
          <button type="button" className="df-editor-link" aria-label={fill(words.choices.removeKind, { name: option.name })} onClick={removeOption}>
            {words.choices.remove}
          </button>
        )}
      </div>
      <div className="df-editor-values">
        {option.values.map((v) => (
          <span key={v.id ?? v.name} className="df-editor-value">
            {v.name}
            {!disabled && (
              <button type="button" aria-label={fill(words.choices.removeValue, { name: v.name })} onClick={() => removeValue(v.name)}>
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            id={id}
            className="df-editor-value-input"
            aria-label={`${option.name}: ${words.choices.valuePlaceholder}`}
            value={typed}
            placeholder={isColour(option.name) ? words.choices.colourPlaceholder : words.choices.valuePlaceholder}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ',') return
              event.preventDefault()
              addValue()
            }}
            onBlur={addValue}
          />
        )}
      </div>
    </div>
  )
}

/** The versions table: price, code and whether each shows; "We don't make this" leaves a combination out. */
const VersionsTable = ({ draft, update, disabled, currency, problems, ask, stock }: { draft: Draft; update: Update; disabled: boolean; currency: string; problems: readonly DraftProblem[]; ask: Ask; stock: VersionStock | null }) => {
  const where = stock?.warehouse ?? null
  const typedAt = (v: DraftVersion) => (where ? (draft.stock[versionKey(v.choices)]?.[where.id] ?? '') : '')
  const setStockOf = (v: DraftVersion, text: string) => where && update((d) => ({ ...d, stock: { ...d.stock, [versionKey(v.choices)]: { ...d.stock[versionKey(v.choices)], [where.id]: text } } }))
  const [search, setSearch] = useState('')
  const live = draft.versions.filter((v) => !v.removed)
  const q = search.trim().toLowerCase()
  const shown = draft.versions.map((v, i) => ({ v, i })).filter(({ v }) => !q || v.choices.join(' ').toLowerCase().includes(q))
  const set = (index: number, patch: Partial<DraftVersion>) => update((d) => ({ ...d, versions: d.versions.map((v, i) => (i === index ? { ...v, ...patch } : v)) }))
  const toggle = (index: number, v: DraftVersion) => {
    const name = v.choices.join(' / ')
    if (v.removed) return set(index, { removed: false })
    if (!v.visible) return set(index, { visible: true })
    const others = draft.versions.filter((x, j) => j !== index && !x.removed && x.visible).length
    if (others === 0) return ask({ title: name, target: name, consequence: words.versions.allHidden, confirmLabel: messages.editor.apply, onConfirm: () => update((d) => ({ ...d, visible: false })) })
    ask({
      title: fill(words.versions.notMakeTitle, { name }),
      target: name,
      consequence: words.versions.notMakeBody,
      confirmLabel: messages.editor.apply,
      choices: [{ key: 'how', label: name, options: [{ value: 'hide', label: words.versions.hideIt }, { value: 'remove', label: words.versions.notMake }], initial: 'hide', error: () => null }],
      onConfirm: (_, __, picks) => set(index, picks['how'] === 'remove' ? { removed: true } : { visible: false }),
    })
  }
  const setAll = () =>
    ask({
      title: words.versions.setPriceTitle,
      target: fill(words.versions.title, { count: formatCount(live.length) }),
      consequence: words.versions.setPriceTitle,
      confirmLabel: messages.editor.apply,
      input: { label: words.versions.setPriceLabel, type: 'text', initial: '', placeholder: '0.00', error: (value) => (typeof minorOf(value, currency) === 'number' && (minorOf(value, currency) as number) > 0 ? null : words.price.missing) },
      onConfirm: (_, value) => update((d) => ({ ...d, versions: d.versions.map((v) => (v.removed ? v : { ...v, price: value ?? v.price })) })),
    })
  return (
    <div className="df-editor-versions">
      <div className="df-editor-versions-head">
        <h3>{fill(words.versions.title, { count: formatCount(live.length) })}</h3>
        {!disabled && (
          <button type="button" className="df-editor-link" onClick={setAll}>
            {words.versions.setPrice}
          </button>
        )}
      </div>
      {stock && where && (
        <div className="df-editor-stock-summary">
          <span>{fill(messages.editor.stock.versionsTotal, { count: formatCount(live.reduce((sum, v) => sum + (Number(typedAt(v)) || 0), 0)) })}</span>
          {(() => {
            const all = draft.versions.flatMap((v) => (v.id && !v.removed ? (stock.levels.get(v.id) ?? []) : []))
            return reservedLine(all, all.reduce((sum, l) => sum + l.onHand, 0))
          })()}
          {draft.versions.some((v) => v.id) && <StockHistory history={stock.history} onToggle={stock.onHistory} names={stock.names} />}
        </div>
      )}
      {stock && !where && <p className="df-editor-hint">{messages.editor.stock.noWarehouse}</p>}
      {draft.versions.length > 8 && <input className="df-editor-versions-search" type="search" aria-label={words.versions.search} placeholder={words.versions.search} value={search} onChange={(event) => setSearch(event.target.value)} />}
      <div className="df-table-scroll">
        <table className="df-table df-editor-versions-table">
          <thead>
            <tr>
              <th>{words.versions.version}</th>
              <th>{words.versions.price}</th>
              {where && <th>{messages.editor.stock.title}</th>}
              <th>{words.versions.code}</th>
              <th>{words.versions.onStore}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ v, i }) => {
              const name = v.choices.join(' / ')
              const bad = !v.removed && problems.includes('price') && !(typeof minorOf(v.price, currency) === 'number' && (minorOf(v.price, currency) as number) > 0)
              return (
                <tr key={name || i} className={v.removed ? 'df-editor-version--removed' : undefined}>
                  <td>{name}</td>
                  <td>
                    <input className="df-editor-cell" inputMode="decimal" aria-label={fill(words.versions.priceOf, { name })} value={v.price} readOnly={disabled || v.removed} aria-invalid={bad} onChange={(event) => set(i, { price: event.target.value })} />
                  </td>
                  {where && (
                    <td>
                      <input className="df-editor-cell df-editor-cell--narrow" inputMode="numeric" aria-label={fill(messages.editor.stock.stockOf, { name })} value={typedAt(v)} placeholder={messages.editor.stock.countPlaceholder} readOnly={!stock?.canStock || v.removed} aria-invalid={problems.includes('stock') && quantityOf(typedAt(v)) === 'invalid'} onChange={(event) => setStockOf(v, event.target.value)} />
                    </td>
                  )}
                  <td>
                    <input className="df-editor-cell" aria-label={fill(words.versions.codeOf, { name })} value={v.sku} maxLength={64} readOnly={disabled || v.removed} onChange={(event) => set(i, { sku: event.target.value })} />
                  </td>
                  <td>
                    <button type="button" className={`df-editor-vis df-editor-vis--${v.removed ? 'removed' : v.visible ? 'visible' : 'hidden'}`} disabled={disabled} aria-label={v.removed || !v.visible ? fill(words.versions.show, { name }) : fill(words.versions.hide, { name })} onClick={() => toggle(i, v)}>
                      {v.removed ? words.versions.notMade : v.visible ? words.versions.visible : words.versions.hidden}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="df-editor-hint">{words.versions.help}</p>
    </div>
  )
}

/** "Does it come in different sizes, colours or other choices?": up to three kinds, then their versions. */
export const ChoicesCard = ({ draft, update, disabled, currency, problems, ask, onToast, stock }: { draft: Draft; update: Update; disabled: boolean; currency: string; problems: readonly DraftProblem[]; ask: Ask; onToast: (text: string) => void; stock: VersionStock | null }) => {
  const addOption = (name: string) => update((d) => ({ ...d, options: [...d.options, { id: null, name: name.trim().slice(0, 60), values: [] }] }))
  if (draft.options.length === 0)
    return (
      <Card>
        <div className="df-editor-ask">
          <div>
            <h2>{words.choices.ask}</h2>
            <p className="df-editor-hint">{words.choices.askSub}</p>
          </div>
          {!disabled && (
            <button type="button" className="df-button" onClick={() => addOption(words.choices.suggest[0] ?? '')}>
              {words.choices.add}
            </button>
          )}
        </div>
      </Card>
    )
  const combos = combinationsOf(draft.options).length
  const fresh = newVersionCount(draft)
  const made = draft.versions.some((v) => v.choices.length === draft.options.length && draft.options.length > 0)
  const parts = draft.options.filter((o) => o.values.length > 0).map((o) => `${o.values.length} ${o.name.toLowerCase()}`).join(' × ')
  const suggestions = words.choices.suggest.filter((s) => !draft.options.some((o) => sameName(o.name, s))).slice(0, 5)
  const generate = () => update((d) => ({ ...d, versions: syncVersions(d) }))
  return (
    <Card title={words.choices.title} aside={<span className="df-editor-meter">{words.choices.limits}</span>}>
      {draft.options.map((o, i) => (
        <OptionRow key={o.id ?? `new-${i}`} draft={draft} index={i} update={update} disabled={disabled} ask={ask} onToast={onToast} />
      ))}
      {!disabled && draft.options.length < maxOptions && (
        <div className="df-editor-suggest">
          <span>{words.choices.addAnother}</span>
          {suggestions.map((s) => (
            <button key={s} type="button" className="df-editor-chip" onClick={() => addOption(s)}>
              + {s}
            </button>
          ))}
          <button
            type="button"
            className="df-editor-chip"
            onClick={() =>
              ask({
                title: words.choices.customTitle,
                target: words.choices.customTitle,
                consequence: words.choices.askSub,
                confirmLabel: messages.editor.apply,
                input: { label: words.choices.customLabel, type: 'text', initial: '', error: (value) => (value.trim() === '' ? words.choices.customTitle : draft.options.some((o) => sameName(o.name, value)) ? fill(words.choices.duplicate, { name: value.trim() }) : null) },
                onConfirm: (_, value) => addOption(value ?? ''),
              })
            }
          >
            {words.choices.custom}
          </button>
        </div>
      )}
      {combos > maxVersions ? (
        <p className="df-editor-generate df-editor-generate--bad" role="alert">
          {fill(words.choices.tooMany, { count: formatCount(combos) })}
        </p>
      ) : (
        parts !== '' && (
          <div className={fresh > 0 ? 'df-editor-generate df-editor-generate--ok' : 'df-editor-generate'}>
            <span>{!made ? fill(combos === 1 ? words.choices.makesOne : words.choices.makes, { parts, count: formatCount(combos) }) : fresh > 0 ? fill(plural(words.choices.newOnes, fresh), { count: formatCount(fresh) }) : words.choices.upToDate}</span>
            {!disabled && fresh > 0 && (
              <button type="button" className="df-button df-button--primary" onClick={generate}>
                {made ? words.choices.update : fill(combos === 1 ? words.choices.createOne : words.choices.create, { count: formatCount(combos) })}
              </button>
            )}
          </div>
        )
      )}
      {made && <VersionsTable draft={draft} update={update} disabled={disabled} currency={currency} problems={problems} ask={ask} stock={stock} />}
    </Card>
  )
}
