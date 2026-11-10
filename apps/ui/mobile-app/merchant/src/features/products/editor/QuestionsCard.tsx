import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { Button } from '../../common/Button'
import { Caret } from '../../common/Caret'
import { LinkButton } from '../../common/LinkButton'
import { Notice } from '../../common/Notice'
import { useFeedback } from '../../shell/Feedback'
import { CopyQuestionsSheet, droppedWords } from './CopyQuestionsSheet'
import { QuestionForm } from './QuestionForm'
import { questionVersionKeys, type Draft } from './draft'
import { dependentsOf, isRequired, maxQuestions, moveQuestion, newQuestion, questionProblems, withValidConditions, type QuestionDraft, type QuestionKind } from './questions'

type Props = {
  client: ApiClient
  draft: Draft
  update: (change: (draft: Draft) => Draft) => void
  disabled: boolean
  currency: string
  /** The product's versions with choices, by key, for prices and "Only for some versions". */
  versions: readonly { key: string; label: string }[]
  /** Save was pressed: a question with a problem says so. */
  attempted: boolean
  /** A vendor whose charge changes go for approval (U15). */
  approval: boolean
  /** Null for a new product; Copy waits for a saved one with nothing unsaved (U12). */
  copy: { productId: string; revision: number; dirty: boolean; onCopied: () => void } | null
}

const kinds: QuestionKind[] = ['CHOICE', 'TEXT', 'UPLOAD']

/** The card's one-line summary (U3). */
export const summaryOf = (q: QuestionDraft, all: readonly QuestionDraft[], versions: readonly { key: string; label: string }[]): string => {
  const parts: string[] = []
  if (q.kind === 'CHOICE') {
    parts.push(q.maxPicks.trim() === '1' ? t('products.questions.summary.pickOne') : t('products.questions.summary.pickUpTo', { count: q.maxPicks }))
    if (Number(q.freePicks) > 0) parts.push(t('products.questions.summary.free', { count: q.freePicks }))
    parts.push(tCount('products.questions.summary.choices', q.choices.length))
  }
  if (q.kind === 'TEXT') parts.push(t('products.questions.summary.characters', { count: q.maxLength }))
  if (q.kind === 'UPLOAD') parts.push(tCount('products.questions.summary.files', Number(q.maxFiles) || 1))
  if (q.price || q.choices.some((c) => c.price)) parts.push(t('products.questions.summary.priced'))
  if (q.shownIf) {
    const target = all.find((x) => x.key === q.shownIf?.question)
    const choice = target?.choices.find((c) => c.key === q.shownIf?.choice)
    if (target && choice) parts.push(t('products.questions.summary.onlyWhen', { question: target.label, choice: choice.label }))
  }
  if (q.versions !== null) parts.push(t('products.questions.summary.onlyFor', { versions: versions.filter((v) => q.versions?.includes(v.key)).map((v) => v.label).join(', ') }))
  return parts.join(' · ')
}

// "Ask the shopper before they buy" (CATALOG-DESIGN §6 U; merchant FIRST-RELEASE §2): collapsed and empty on a product without questions,
// each question a stacked card with Edit, Move up, Move down and Delete, its form full screen; the product's own Save sends them.
export function QuestionsCard({ client, draft, update, disabled, currency, versions, attempted, approval, copy }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const questions = draft.questions
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<{ at: number; question: QuestionDraft; isNew: boolean } | null>(null)
  const [copying, setCopying] = useState(false)
  const problems = attempted ? questionProblems(questions, currency, questionVersionKeys(draft)) : []
  const atLimit = questions.length >= maxQuestions
  const sub = questions.length === 0 ? t('products.questions.hint') : tCount('products.questions.count', questions.length)
  const setQuestions = (change: (list: QuestionDraft[]) => QuestionDraft[]) => update((d) => ({ ...d, questions: withValidConditions(change(d.questions)) }))

  const add = () =>
    feedback.menu({
      title: t('products.questions.add'),
      items: kinds.map((kind) => ({ key: kind, label: t(`products.questions.addKinds.${kind}`), onPress: () => setEditing({ at: questions.length, question: newQuestion(kind), isNew: true }) })),
    })

  const remove = (q: QuestionDraft) => {
    const dependent = dependentsOf(questions, q.key)[0]
    feedback.sheet({
      title: t('products.questions.deleteTitle', { label: q.label || t('products.questions.untitled') }),
      body: dependent ? t('products.questions.deleteBodyDepends', { question: dependent.label, label: q.label }) : t('products.questions.deleteBody'),
      confirm: t('products.questions.delete'),
      danger: true,
      onConfirm: () => setQuestions((list) => list.filter((x) => x.key !== q.key)),
    })
  }

  const actions = (q: QuestionDraft, at: number) => {
    const name = q.label || t('products.questions.untitled')
    feedback.menu({
      title: name,
      items: disabled
        ? [{ key: 'view', label: t('products.questions.view'), onPress: () => setEditing({ at, question: q, isNew: false }) }]
        : [
            { key: 'edit', label: t('products.questions.edit'), onPress: () => setEditing({ at, question: q, isNew: false }) },
            ...(at > 0 ? [{ key: 'up', label: t('products.questions.moveUp'), onPress: () => setQuestions((list) => moveQuestion(list, at, -1)) }] : []),
            ...(at < questions.length - 1 ? [{ key: 'down', label: t('products.questions.moveDown'), onPress: () => setQuestions((list) => moveQuestion(list, at, 1)) }] : []),
            { key: 'delete', label: t('products.questions.delete'), danger: true, onPress: () => remove(q) },
          ],
    })
  }

  const startCopy = () => {
    if (!copy || copy.dirty) return feedback.toast({ message: t('products.questions.copy.saveFirst') })
    setCopying(true)
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('products.questions.title')}, ${sub}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.head}>
        <View style={styles.headText}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('products.questions.title')}
          </Text>
          <Text style={[styles.sub, { color: problems.length > 0 ? colors.danger : colors.muted }]}>
            {sub}
          </Text>
        </View>
        <Caret color={colors.muted} />
      </Pressable>
      {open ? (
        <>
          {approval ? <Notice text={t('products.questions.approval')} /> : null}
          {questions.length === 0 ? <Text style={[styles.sub, { color: colors.textStrong }]}>{t('products.questions.empty')}</Text> : null}
          {questions.map((q, at) => {
            const name = q.label || t('products.questions.untitled')
            const broken = problems.some((p) => p.question === q.key)
            return (
              <View key={q.key} style={[styles.question, { borderColor: broken ? colors.danger : colors.border, borderRadius: radii.button }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={t(disabled ? 'products.questions.viewNamed' : 'products.questions.editNamed', { name })} onPress={() => setEditing({ at, question: q, isNew: false })} style={styles.questionText}>
                  <Text style={[styles.label, { color: colors.text }]}>{name}</Text>
                  <Text style={[styles.sub, { color: colors.muted }]}>
                    {t(`products.questions.kinds.${q.kind}`)} · {t(isRequired(q) ? 'products.questions.required' : 'products.questions.optional')}
                  </Text>
                  <Text style={[styles.sub, { color: colors.muted }]}>{summaryOf(q, questions, versions)}</Text>
                  {broken ? <Text style={[styles.sub, { color: colors.danger }]}>{t('products.questions.fix')}</Text> : null}
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('products.questions.actions', { name })} onPress={() => actions(q, at)} style={styles.more}>
                  <Text style={[styles.moreText, { color: colors.link }]}>⋯</Text>
                </Pressable>
              </View>
            )
          })}
          {disabled ? null : (
            <>
              <Button kind="secondary" label={t('products.questions.add')} disabled={atLimit} onPress={add} />
              {atLimit ? <Text style={[styles.sub, { color: colors.muted }]}>{t('products.questions.questionLimit')}</Text> : null}
              <LinkButton label={t('products.questions.copy.link')} onPress={startCopy} />
            </>
          )}
        </>
      ) : null}
      {editing ? (
        <QuestionForm
          question={editing.question}
          all={editing.isNew ? [...questions, editing.question] : questions}
          at={editing.at}
          currency={currency}
          versions={versions}
          disabled={disabled}
          onClose={() => setEditing(null)}
          onDone={(q) => {
            setQuestions((list) => (editing.isNew ? [...list, q] : list.map((x) => (x.key === q.key ? q : x))))
            setEditing(null)
          }}
        />
      ) : null}
      {copying && copy ? (
        <CopyQuestionsSheet
          client={client}
          productId={copy.productId}
          revision={copy.revision}
          hasQuestions={questions.length > 0}
          onClose={() => setCopying(false)}
          onCopied={(copied) => {
            feedback.toast({ message: [t('products.questions.copy.done'), ...droppedWords(copied)].join(' ') })
            copy.onCopied()
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  question: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingLeft: 12 },
  questionText: { flex: 1, gap: 2, paddingVertical: 10, minHeight: 44 },
  label: { fontSize: 15, fontWeight: '700' },
  more: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 22, fontWeight: '800' },
})
