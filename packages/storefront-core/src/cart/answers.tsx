'use client'

import { lazy, Suspense, useState } from 'react'
import { z } from 'zod'
import { useStorefront } from '../platform/store/context'
import { formatMoney } from '../pricing/money'
import { decodeQuestions, questionFields, questionsSchema, type Answer, type Question } from '../products/questions'
import type { Translate } from '../platform/i18n/i18n'
import type { CartLine, LineAnswer } from './cart'

// A customised cart line (storefront ARCHITECTURE §3.5; #1372): its answers as the engine priced them, and Edit, which
// reopens the modal filled in. The theme places and styles them; the words and amounts are core's.

const CustomiseModal = lazy(() => import('../sealed/customise').then((m) => ({ default: m.CustomiseModal })))

/** What was answered, in words: choices listed by the shopper's locale, text as typed, files counted. */
export const answerText = (a: LineAnswer, locale: string, t: Translate): string =>
  a.kind === 'CHOICE'
    ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(a.choices.map((c) => (c.quantity > 1 ? t('customise.choiceCount', { label: c.label, count: c.quantity }) : c.label)))
    : a.kind === 'TEXT'
      ? (a.text ?? '')
      : t('customise.files', { count: a.uploads.length })

/** The answers under a cart line, one per row ("Toppings: Cheese × 2"), each extra's amount beside it. */
export const LineAnswers = ({ line, className }: { line: CartLine; className?: string }) => {
  const { locale, t } = useStorefront()
  if (line.answers.length === 0) return null
  return (
    <dl className={className} aria-label={t('customise.answers')} data-df-line-answers="">
      {line.answers.map((a) => (
        <div key={a.questionId}>
          <dt>{a.question}</dt>
          <dd>
            {answerText(a, locale, t)}
            {a.amount && /[1-9]/.test(a.amount.amount) ? <span> {t('customise.extra', { price: formatMoney(a.amount, locale) })}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const questionsQuery = `query Questions($slug: String!) { product(slug: $slug) { name ${questionFields} } }`
const questionsAnswer = z.object({ product: z.object({ name: z.string().nullable().optional(), questions: questionsSchema }).nullable() })

/** The line's answers as the modal starts from them. */
export const answersOfLine = (line: CartLine): Answer[] =>
  line.answers.map((a) => ({ questionId: a.questionId, ...(a.kind === 'CHOICE' ? { choices: a.choices.map((c) => ({ choiceId: c.choiceId, quantity: c.quantity })) } : a.kind === 'TEXT' ? { text: a.text ?? '' } : { uploadIds: a.uploads.map((u) => u.id) }) }))

/** Edit on a customised line, or "Check your choices" on one whose answers no longer fit; nothing on any other line. */
export const EditAnswers = ({ line, className }: { line: CartLine; className?: string }) => {
  const { client, t } = useStorefront()
  const [product, setProduct] = useState<{ name: string; questions: Question[] } | null>(null)
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!line.lineId || !line.slug || (line.answers.length === 0 && line.problem !== 'check_answers')) return null
  const { lineId, slug } = line
  const open = () => {
    setOpening(true)
    setFailed(false)
    client.query(questionsQuery, questionsAnswer, { slug }).then(
      ({ product: p }) => {
        setOpening(false)
        const questions = decodeQuestions(p?.questions)
        // None to answer any more (the product changed or went): say so rather than open nothing.
        if (questions.length > 0) setProduct({ name: p?.name ?? line.name, questions })
        else setFailed(true)
      },
      () => {
        setOpening(false)
        setFailed(true)
      },
    )
  }
  return (
    <>
      <button type="button" className={className} data-df-action="edit-answers" disabled={opening || line.pending} aria-label={t('customise.editNamed', { name: line.name })} onClick={open}>
        {t(line.problem === 'check_answers' ? 'customise.check' : 'customise.edit')}
      </button>
      {failed && <span role="alert">{t('customise.editFailed')}</span>}
      {product && (
        <Suspense fallback={null}>
          <CustomiseModal product={product} versionId={line.versionId} quantity={line.quantity} initial={answersOfLine(line)} intent={{ kind: 'edit', lineId }} onClose={() => setProduct(null)} />
        </Suspense>
      )}
    </>
  )
}
