import { pluralForm } from '../format'
import { locale, t, type MessageKey } from './index'

type Values = Readonly<Record<string, string | number>>

/** The words for a count: `<key>.one`, `<key>.other` and the like, by the locale's plural rules, with `{count}` filled. */
export const tCount = (key: string, count: number, values: Values = {}): string => {
  const forms = (form: Intl.LDMLPluralRule) => t(`${key}.${form}` as MessageKey, { ...values, count })
  return pluralForm(locale, { one: forms('one'), other: forms('other') }, count)
}
