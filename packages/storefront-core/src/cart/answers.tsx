'use client'

import { lazy, Suspense } from 'react'
import type { Translate } from '../platform/i18n/i18n'
import type { CartLine, LineAnswer } from './cart'

// A customised cart line (storefront ARCHITECTURE §3.5; #1372): its answers as the engine priced them, and Edit, which
// reopens the modal filled in. The theme places and styles them; the words and amounts are core's.

// Their code and words load only for a line that has answers (ARCHITECTURE §9), so a cart without any carries none of it.
const View = lazy(() => import('./answersView').then((m) => ({ default: m.AnswersView })))

/** What was answered, in words: choices listed by the shopper's locale, text as typed, files counted. */
export const answerText = (a: LineAnswer, locale: string, t: Translate): string =>
  a.kind === 'CHOICE'
    ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(a.choices.map((c) => (c.quantity > 1 ? t('customise.choiceCount', { label: c.label, count: c.quantity }) : c.label)))
    : a.kind === 'TEXT'
      ? (a.text ?? '')
      : t('customise.files', { count: a.uploads.length })

/** The answers under a cart line, one per row ("Toppings: Cheese × 2"), each extra's amount beside it. */
export const LineAnswers = ({ line, className }: { line: CartLine; className?: string | undefined }) =>
  line.answers.length === 0 ? null : (
    <Suspense fallback={null}>
      <View kind="line" line={line} className={className} />
    </Suspense>
  )

/** Edit on a customised line, or "Check your choices" on one whose answers no longer fit; nothing on any other line. */
export const EditAnswers = ({ line, className }: { line: CartLine; className?: string | undefined }) =>
  !line.lineId || !line.slug || (line.answers.length === 0 && line.problem !== 'check_answers') ? null : (
    <Suspense fallback={null}>
      <View kind="edit" line={line} className={className} />
    </Suspense>
  )
