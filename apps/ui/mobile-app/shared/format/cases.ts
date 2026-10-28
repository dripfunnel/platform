import { formatDateTime } from './dateTime'
import { formatDuration } from './duration'
import { formatList } from './list'
import { formatMoney } from './money'
import { formatNumber } from './number'
import { pluralForm } from './plural'

// The format inputs and what they must print. Jest runs them on Node, and the Hermes check
// (REACT-NATIVE.md §6) runs the same list on the phone, so one list proves both.
export type FormatCase = { group: string; name: string; actual: (locale: string) => string; expected: string }

const NBSP = '\u00a0'
const itemsOf = (locale: string, count: number) => pluralForm(locale, { one: `${count} item`, other: `${count} items` }, count)

export const formatCases: readonly FormatCase[] = [
  // Money: the currency's own digit count turns minor units into the price.
  { group: 'money', name: 'INR, 2 digits', actual: (l) => formatMoney({ amount: 123_456, currency: 'INR' }, l), expected: '₹1,234.56' },
  { group: 'money', name: 'INR, millions', actual: (l) => formatMoney({ amount: 123_456_789, currency: 'INR' }, l), expected: '₹1,234,567.89' },
  { group: 'money', name: 'USD, 2 digits', actual: (l) => formatMoney({ amount: 123_456, currency: 'USD' }, l), expected: '$1,234.56' },
  { group: 'money', name: 'USD, five cents', actual: (l) => formatMoney({ amount: 5, currency: 'USD' }, l), expected: '$0.05' },
  { group: 'money', name: 'USD, negative', actual: (l) => formatMoney({ amount: -1999, currency: 'USD' }, l), expected: '-$19.99' },
  { group: 'money', name: 'JPY, 0 digits', actual: (l) => formatMoney({ amount: 123_456, currency: 'JPY' }, l), expected: '¥123,456' },
  { group: 'money', name: 'KWD, 3 digits', actual: (l) => formatMoney({ amount: 1_234_567, currency: 'KWD' }, l), expected: `KWD${NBSP}1,234.567` },
  { group: 'money', name: 'EUR, zero', actual: (l) => formatMoney({ amount: 0, currency: 'EUR' }, l), expected: '€0.00' },
  // Dates: one instant, shown in each named zone with the zone's name.
  { group: 'dateTime', name: 'UTC', actual: (l) => formatDateTime('2026-10-13T00:30:00Z', l, 'UTC'), expected: 'Oct 13, 2026, 00:30 UTC' },
  { group: 'dateTime', name: 'Asia/Kolkata, half-hour offset', actual: (l) => formatDateTime('2026-10-13T00:30:00Z', l, 'Asia/Kolkata'), expected: 'Oct 13, 2026, 06:00 GMT+5:30' },
  { group: 'dateTime', name: 'America/New_York, the day before', actual: (l) => formatDateTime('2026-10-13T00:30:00Z', l, 'America/New_York'), expected: 'Oct 12, 2026, 20:30 EDT' },
  { group: 'dateTime', name: 'Europe/London, summer time', actual: (l) => formatDateTime('2026-07-01T12:00:00Z', l, 'Europe/London'), expected: 'Jul 1, 2026, 13:00 GMT+1' },
  // Numbers, plurals, lists and durations.
  { group: 'number', name: 'grouping and decimals', actual: (l) => formatNumber(1_234_567.891, l), expected: '1,234,567.891' },
  { group: 'number', name: 'a fraction', actual: (l) => formatNumber(0.5, l), expected: '0.5' },
  { group: 'plural', name: 'one', actual: (l) => itemsOf(l, 1), expected: '1 item' },
  { group: 'plural', name: 'other, 0', actual: (l) => itemsOf(l, 0), expected: '0 items' },
  { group: 'plural', name: 'other, 2', actual: (l) => itemsOf(l, 2), expected: '2 items' },
  { group: 'list', name: 'three items', actual: (l) => formatList(['a', 'b', 'c'], l), expected: 'a, b, and c' },
  { group: 'list', name: 'two items', actual: (l) => formatList(['a', 'b'], l), expected: 'a and b' },
  { group: 'list', name: 'one item', actual: (l) => formatList(['a'], l), expected: 'a' },
  { group: 'duration', name: 'days and hours', actual: (l) => formatDuration(90_061, l), expected: '1 day 1 hr' },
  { group: 'duration', name: 'minutes and seconds', actual: (l) => formatDuration(372, l), expected: '6 min 12 sec' },
  { group: 'duration', name: 'seconds', actual: (l) => formatDuration(45, l), expected: '45 sec' },
  { group: 'duration', name: 'a whole unit', actual: (l) => formatDuration(7200, l), expected: '2 hr' },
]
