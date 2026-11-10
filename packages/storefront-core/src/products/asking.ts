import type { Answer, Question } from './questions'

// Which questions a version asks and what is sent, used only by the modal, so its lazy chunk carries them.

/** The questions this version asks, given the answers so far: its versions, and a condition's choice picked (fact 54). */
export const askedFor = (questions: readonly Question[], versionId: string, answers: readonly Answer[]): Question[] => {
  const picked = new Set(answers.flatMap((a) => (a.choices ?? []).filter((c) => c.quantity > 0).map((c) => c.choiceId)))
  return questions.filter((q) => (q.versionIds === null || q.versionIds.includes(versionId)) && (q.shownIf === null || picked.has(q.shownIf.choiceId)))
}

/** Only the answers to questions still asked, with nothing empty, as the engine reads them. */
export const answersToSend = (questions: readonly Question[], versionId: string, answers: readonly Answer[]): Answer[] => {
  const asked = new Set(askedFor(questions, versionId, answers).map((q) => q.id))
  return answers.flatMap((a): Answer[] => {
    if (!asked.has(a.questionId)) return []
    const choices = (a.choices ?? []).filter((c) => c.quantity > 0)
    if (choices.length > 0) return [{ questionId: a.questionId, choices }]
    if (a.text !== undefined && a.text.trim() !== '') return [{ questionId: a.questionId, text: a.text }]
    if (a.uploadIds && a.uploadIds.length > 0) return [{ questionId: a.questionId, uploadIds: a.uploadIds }]
    return []
  })
}
