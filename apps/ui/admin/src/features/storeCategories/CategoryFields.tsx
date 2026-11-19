import { useId } from 'react'
import { categorySections } from '../../api/storeCategories'
import { fill, messages } from '../../messages'
import type { CategoryForm } from './categoryForm'
import '../partners/partners.css'
import './storeCategories.css'

const words = messages.storeCategories

export interface CategoryFieldsProps {
  value: CategoryForm
  onChange: (value: CategoryForm) => void
}

// The add and edit dialogs' fields: English name, translations, and the product page sections offered.
export const CategoryFields = ({ value, onChange }: CategoryFieldsProps) => {
  const englishId = useId()
  const englishHintId = useId()
  const setTranslation = (index: number, part: 'language' | 'name', text: string) =>
    onChange({ ...value, translations: value.translations.map((t, i) => (i === index ? { ...t, [part]: text } : t)) })

  return (
    <>
      <div className="df-field">
        <label htmlFor={englishId}>{words.form.english}</label>
        <input id={englishId} type="text" maxLength={60} required aria-describedby={englishHintId} value={value.english} onChange={(event) => onChange({ ...value, english: event.target.value })} />
        <p id={englishHintId} className="df-field-hint">
          {words.form.englishHint}
        </p>
      </div>
      <fieldset className="df-choices">
        <legend>{words.form.translations}</legend>
        <p className="df-field-hint">{words.form.translationsHint}</p>
        {value.translations.map((t, index) => (
          <div key={index} className="df-category-translation">
            <label>
              <span>{words.form.language}</span>
              <input type="text" maxLength={6} value={t.language} onChange={(event) => setTranslation(index, 'language', event.target.value)} />
            </label>
            <label>
              <span>{words.form.translatedName}</span>
              <input type="text" maxLength={60} value={t.name} onChange={(event) => setTranslation(index, 'name', event.target.value)} />
            </label>
            <button
              type="button"
              className="df-button df-button--small"
              aria-label={fill(words.form.removeTranslation, { language: t.language || '—' })}
              onClick={() => onChange({ ...value, translations: value.translations.filter((_, i) => i !== index) })}
            >
              {words.form.remove}
            </button>
          </div>
        ))}
        <button type="button" className="df-button df-button--small" onClick={() => onChange({ ...value, translations: [...value.translations, { language: '', name: '' }] })}>
          {words.form.addTranslation}
        </button>
      </fieldset>
      <fieldset className="df-choices">
        <legend>{words.form.sectionsLegend}</legend>
        <p className="df-field-hint">{words.form.sectionsHint}</p>
        <div className="df-currency-grid">
          {categorySections.map((section) => (
            <label key={section} className="df-choice">
              <input
                type="checkbox"
                checked={value.sections.includes(section)}
                onChange={(event) =>
                  onChange({ ...value, sections: event.target.checked ? categorySections.filter((s) => s === section || value.sections.includes(s)) : value.sections.filter((s) => s !== section) })
                }
              />
              <span>{words.sections[section]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}
