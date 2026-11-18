import { categorySections, type CategoryInput, type CategorySection, type StoreCategory } from '../../api/storeCategories'
import { messages } from '../../messages'

const words = messages.storeCategories.form

export interface CategoryForm {
  english: string
  translations: { language: string; name: string }[]
  sections: CategorySection[]
}

export const emptyForm: CategoryForm = { english: '', translations: [], sections: [] }

export const formOf = (category: StoreCategory): CategoryForm => ({
  english: category.names.find((n) => n.language === 'en')?.name ?? '',
  translations: category.names.filter((n) => n.language !== 'en'),
  sections: categorySections.filter((s) => category.sections.includes(s)),
})

const languageCode = /^[a-z]{2,3}(-[A-Z]{2})?$/
const maxName = 60

// Why the form can't be saved yet, or null: the API's own rules (saas/storeCategories), said before the round trip.
export const formProblem = (form: CategoryForm): string | null => {
  if (form.english.trim() === '') return words.englishMissing
  const names = [form.english, ...form.translations.map((t) => t.name)]
  if (names.some((n) => n.trim().length > maxName)) return words.tooLong
  const codes = form.translations.map((t) => t.language.trim())
  if (form.translations.some((t) => !languageCode.test(t.language.trim()) || t.language.trim() === 'en' || t.name.trim() === '') || new Set(codes).size !== codes.length) return words.badLanguage
  return null
}

export const inputOf = (form: CategoryForm): CategoryInput => ({
  names: [{ language: 'en', name: form.english.trim() }, ...form.translations.map((t) => ({ language: t.language.trim(), name: t.name.trim() }))],
  sections: categorySections.filter((s) => form.sections.includes(s)),
})
