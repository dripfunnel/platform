import type { Product, ProductOption, ProductVersion } from '../../api/catalogue'

/** The value chosen for each option, by option id. */
export type Selection = Readonly<Record<string, string>>

type Variants = Pick<Product, 'options' | 'versions'>

/** What needs no choosing is chosen: an option with a single value. */
export const initialSelection = ({ options }: Variants): Selection => Object.fromEntries(options.flatMap((option) => (option.values.length === 1 && option.values[0] ? [[option.id, option.values[0].id]] : [])))

export const missingOptions = ({ options }: Variants, selection: Selection): ProductOption[] => options.filter((option) => !selection[option.id])

/** The version the choices name, once every option is chosen; a product with no options has one version. */
export const versionFor = ({ options, versions }: Variants, selection: Selection): ProductVersion | null => {
  if (options.length === 0) return versions[0] ?? null
  if (options.some((option) => !selection[option.id])) return null
  return versions.find((version) => options.every((option) => version.choices[option.id] === selection[option.id])) ?? null
}

/** `disabled`: no version has this value with the other choices made. `soldOut`: some do, and none is in stock (still choosable, so the shopper sees why). */
export type ValueState = 'available' | 'soldOut' | 'disabled'

export const valueState = ({ options, versions }: Variants, selection: Selection, optionId: string, valueId: string): ValueState => {
  const others = options.filter((option) => option.id !== optionId && selection[option.id])
  const matching = versions.filter((version) => version.choices[optionId] === valueId && others.every((option) => version.choices[option.id] === selection[option.id]))
  if (matching.length === 0) return 'disabled'
  return matching.every((version) => !version.inStock) ? 'soldOut' : 'available'
}

/** Choosing the value that is already chosen takes it back, so a shopper can leave a dead end. */
export const choose = (selection: Selection, optionId: string, valueId: string): Selection => {
  const { [optionId]: chosen, ...rest } = selection
  return chosen === valueId ? rest : { ...rest, [optionId]: valueId }
}
