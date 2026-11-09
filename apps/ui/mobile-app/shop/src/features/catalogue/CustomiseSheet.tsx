import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { Image } from 'expo-image'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useOnline } from '@dripfunnel/mobile-shared/connection'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { addWithAnswers, answersToSend, askedFor, quote, removeFile, uploadFile, type Answer, type ExtraPrice, type Question, type Quote } from '../../api/customisation'
import { useShop } from '../../api/ShopContext'
import { t, type MessageKey } from '../../messages'
import { Button, Sheet } from '../common/ui'
import { money } from './words'

// The customisation sheet (CATALOG-DESIGN §3 facts 49–57; shop/FIRST-RELEASE §2 "Customisation"; #1373): every question a
// product asks, the live total from the Shop API (never computed here), photos from the library or camera, and PDFs.

/** Adding the version, or saving a line's new answers the way the cart shows its answer (`save` throws on a refusal). */
export type CustomiseIntent = { kind: 'add' } | { kind: 'edit'; save: (answers: Answer[]) => Promise<void> }

type FileRow = { key: string; name: string; id: string | null; percent: number; failed: MessageKey | null }

const problemKeys = ['REQUIRED', 'TOO_FEW_PICKS', 'TOO_MANY_PICKS', 'QUANTITY_TOO_HIGH', 'CHOICE_UNAVAILABLE', 'TEXT_TOO_LONG', 'TOO_MANY_FILES', 'UPLOAD_NOT_FOUND'] as const
const refusalKeys = ['FILE_TYPE', 'FILE_TOO_LARGE', 'TOO_MANY_UPLOADS', 'RATE_LIMITED', 'UPLOAD_IN_USE', 'ONE_LINE_PER_VERSION'] as const
const problemText = (reason: string): string => t((problemKeys as readonly string[]).includes(reason) ? (`customise.problem.${reason}` as MessageKey) : 'customise.problem.other')
const refusalText = (code: string): MessageKey => ((refusalKeys as readonly string[]).includes(code) ? (`customise.refused.${code}` as MessageKey) : 'customise.refused.other')

const extraText = (price: ExtraPrice | null): string | null => {
  if (!price) return null
  if (price.mode === 'PERCENT') return price.percentBps === null ? null : t('customise.extraPercent', { percent: price.percentBps / 100 })
  if (!price.amount) return t('customise.unavailable')
  return price.mode === 'PER_CHARACTER' ? t('customise.extraPerCharacter', { price: money(price.amount) }) : t('customise.extra', { price: money(price.amount) })
}

export function CustomiseSheet({ product, versionId, quantity, initial, intent, onDone, onClose }: { product: { name: string; questions: readonly Question[] }; versionId: string; quantity: number; initial: readonly Answer[]; intent: CustomiseIntent; onDone: () => void; onClose: () => void }) {
  const { client, host, uploadHeaders, saveCartToken } = useShop()
  const { colors, radii } = useTheme()
  const online = useOnline()
  const [answers, setAnswers] = useState<Answer[]>(() => initial.map((a) => ({ ...a })))
  const [files, setFiles] = useState<Record<string, FileRow[]>>(() =>
    Object.fromEntries(initial.filter((a) => (a.uploadIds ?? []).length > 0).map((a) => [a.questionId, (a.uploadIds ?? []).map((id, i) => ({ key: id, name: t('customise.file', { number: i + 1 }), id, percent: 1, failed: null }))])),
  )
  const [live, setLive] = useState<Quote | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState<Record<string, MessageKey>>({})
  const uploadedHere = useRef(new Set<string>())
  const dropped = useRef(new Set<string>())

  const asked = useMemo(() => askedFor(product.questions, versionId, answers), [product.questions, versionId, answers])
  const sent = useMemo(() => answersToSend(product.questions, versionId, answers), [product.questions, versionId, answers])
  const answerOf = (id: string) => answers.find((a) => a.questionId === id)
  const set = (questionId: string, patch: Omit<Answer, 'questionId'>) => setAnswers((list) => [...list.filter((a) => a.questionId !== questionId), { questionId, ...patch }])

  // The live total: the newest answer wins, a moment after the last change.
  const asks = useRef(0)
  useEffect(() => {
    if (!online) return
    const n = (asks.current += 1)
    const timer = setTimeout(() => {
      quote(client, versionId, quantity, sent).then(
        (q) => n === asks.current && setLive(q),
        () => n === asks.current && setLive(null),
      )
    }, 250)
    return () => clearTimeout(timer)
  }, [client, versionId, quantity, sent, online])

  const closed = useRef(false)
  const saving = useRef(false)
  // Files this sheet uploaded are taken back when it goes without saving (Cancel, Back, or the screen leaving), so none is left to count.
  const takeBack = useRef<() => void>(() => undefined)
  takeBack.current = () => {
    closed.current = true
    for (const id of uploadedHere.current) void removeFile(host, uploadHeaders(), id)
    uploadedHere.current.clear()
  }
  useEffect(() => {
    // Set again on mount, as development's double mount runs the cleanup once.
    closed.current = false
    return () => {
      if (!saving.current) takeBack.current()
    }
  }, [])
  const close = () => {
    // Not while the cart takes the answers: its files may be the new line's.
    if (busy) return
    takeBack.current()
    onClose()
  }

  const upload = (q: Question, picked: { uri: string; mime: string; name: string }) => {
    const key = `${q.id}-${Date.now()}-${picked.name}`
    setFiles((all) => ({ ...all, [q.id]: [...(all[q.id] ?? []), { key, name: picked.name, id: null, percent: 0, failed: null }] }))
    const patch = (change: Partial<FileRow>) => setFiles((all) => ({ ...all, [q.id]: (all[q.id] ?? []).map((f) => (f.key === key ? { ...f, ...change } : f)) }))
    void uploadFile(host, uploadHeaders(), q.id, picked, (share) => patch({ percent: share })).then(async (result) => {
      if (!result.ok) return patch({ failed: refusalText(result.code) })
      if (result.cartToken) await saveCartToken(result.cartToken)
      // Removed, or the sheet closed without saving, while it was going up: never kept, taken back.
      if (dropped.current.has(key) || closed.current) return void removeFile(host, uploadHeaders(), result.id)
      uploadedHere.current.add(result.id)
      patch({ id: result.id, percent: 1 })
      setAnswers((list) => {
        const was = list.find((a) => a.questionId === q.id)?.uploadIds ?? []
        return [...list.filter((a) => a.questionId !== q.id), { questionId: q.id, uploadIds: [...was, result.id] }]
      })
    })
  }
  const removeRow = (q: Question, f: FileRow) => {
    setFiles((all) => ({ ...all, [q.id]: (all[q.id] ?? []).filter((x) => x.key !== f.key) }))
    if (!f.id) {
      dropped.current.add(f.key)
      return
    }
    const id = f.id
    setAnswers((list) => list.map((a) => (a.questionId === q.id ? { ...a, uploadIds: (a.uploadIds ?? []).filter((u) => u !== id) } : a)))
    // A file already on the saved line stays until Save releases it (#1369), so Cancel leaves the line as it was.
    if (!uploadedHere.current.delete(id)) return
    void removeFile(host, uploadHeaders(), id).then((code) => {
      if (code === null) return
      // Still on the server and still counted: back on screen so the shopper can try again.
      uploadedHere.current.add(id)
      setFiles((all) => ({ ...all, [q.id]: [...(all[q.id] ?? []), { ...f, failed: 'customise.removeFailed' }] }))
    })
  }
  const pickPhoto = async (q: Question, camera: boolean) => {
    const asked = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!asked.granted) return setDenied((all) => ({ ...all, [q.id]: camera ? 'customise.cameraDenied' : 'customise.photosDenied' }))
    setDenied((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== q.id)))
    const picked = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 })
    const asset = picked.canceled ? undefined : picked.assets[0]
    if (asset) upload(q, { uri: asset.uri, mime: asset.mimeType ?? 'image/jpeg', name: asset.fileName ?? t('customise.file', { number: (files[q.id] ?? []).length + 1 }) })
  }
  const pickFile = async (q: Question) => {
    const picked = await DocumentPicker.getDocumentAsync({ type: q.accept === 'PDF' ? 'application/pdf' : ['application/pdf', 'image/*'], copyToCacheDirectory: true })
    const asset = picked.canceled ? undefined : picked.assets[0]
    if (asset) upload(q, { uri: asset.uri, mime: asset.mimeType ?? 'application/pdf', name: asset.name })
  }

  const confirm = async () => {
    setShowProblems(true)
    setError(null)
    if (!online) return setError(t('customise.offline'))
    setBusy(true)
    saving.current = true
    try {
      // Decided on a quote of exactly these answers, asked now: the live one may be late or missing.
      asks.current += 1
      const fresh = await quote(client, versionId, quantity, sent)
      setLive(fresh)
      if (fresh.problems.length > 0) {
        // A problem no question on screen can show (none named, or no longer asked) is said here, never silently.
        const shown = new Set(askedFor(product.questions, versionId, answers).map((q) => q.id))
        const loose = fresh.problems.find((p) => p.questionId === null || !shown.has(p.questionId))
        if (loose) setError(problemText(loose.reason))
        return
      }
      if (intent.kind === 'edit') await intent.save(sent)
      else {
        const token = await addWithAnswers(client, versionId, quantity, sent)
        if (token) await saveCartToken(token)
      }
      uploadedHere.current.clear()
      onDone()
    } catch (e) {
      setError(isApiError(e) && (refusalKeys as readonly string[]).includes(e.code) ? t(refusalText(e.code)) : t('customise.failed'))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const uploading = Object.values(files).some((list) => list.some((f) => !f.id && !f.failed))
  return (
    <Sheet
      title={t(intent.kind === 'edit' ? 'customise.editTitle' : 'customise.title', { name: product.name })}
      onClose={close}
      footer={
        <View style={styles.footer}>
          <View accessibilityLiveRegion="polite" style={styles.total}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{t('customise.total')}</Text>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{live?.lineTotal ? money(live.lineTotal) : t('customise.totalWorking')}</Text>
          </View>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
              {error}
            </Text>
          ) : null}
          <Button saves label={t(intent.kind === 'edit' ? 'customise.save' : 'customise.add')} disabled={uploading} busy={busy} onPress={() => void confirm()} />
          <Button kind="secondary" label={t('customise.cancel')} disabled={busy} onPress={close} />
        </View>
      }
    >
      {asked.map((q) => {
        const problem = showProblems ? live?.problems.find((p) => p.questionId === q.id) : undefined
        const a = answerOf(q.id)
        const rows = files[q.id] ?? []
        const refused = denied[q.id]
        return (
          <View key={q.id} style={styles.question}>
            <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '700' }}>
              {q.label} <Text style={{ color: colors.muted, fontWeight: '400' }}>({t(q.required || q.minPicks > 0 ? 'customise.required' : 'customise.optional')})</Text>
            </Text>
            {q.help ? <Text style={{ color: colors.muted, fontSize: 14 }}>{q.help}</Text> : null}
            {q.kind === 'CHOICE' && q.maxPicks > 1 ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('customise.pickUpTo', { count: q.maxPicks })}</Text> : null}
            {q.kind === 'CHOICE' && q.minPicks > 1 ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('customise.pickAtLeast', { count: q.minPicks })}</Text> : null}
            {q.kind === 'CHOICE' && q.freePicks > 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('customise.free', { count: q.freePicks })}</Text> : null}
            {problem ? (
              <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
                {problemText(problem.reason)}
              </Text>
            ) : null}
            {q.kind === 'CHOICE' && q.maxPicks === 1 && !q.required && q.minPicks === 0 ? (
              <Pressable accessibilityRole="radio" accessibilityState={{ checked: !(a?.choices ?? []).some((c) => c.quantity > 0) }} accessibilityLabel={t('customise.none')} onPress={() => set(q.id, { choices: [] })} style={styles.row}>
                <Text style={{ color: colors.text, fontSize: 16 }}>{t('customise.none')}</Text>
              </Pressable>
            ) : null}
            {q.kind === 'CHOICE'
              ? q.choices.map((c) => {
                  const picked = a?.choices?.find((x) => x.choiceId === c.id)?.quantity ?? 0
                  const one = q.maxPicks === 1
                  const unavailable = !c.available || (c.price !== null && c.price.mode !== 'PERCENT' && c.price.amount === null)
                  const extra = unavailable ? t('customise.unavailable') : extraText(c.price)
                  const pick = (n: number) => {
                    const others = one ? [] : (a?.choices ?? []).filter((x) => x.choiceId !== c.id)
                    set(q.id, { choices: n > 0 ? [...others, { choiceId: c.id, quantity: n }] : others })
                  }
                  return (
                    <View key={c.id} style={styles.row}>
                      <Pressable
                        accessibilityRole={one ? 'radio' : 'checkbox'}
                        accessibilityState={{ checked: picked > 0, disabled: unavailable }}
                        accessibilityLabel={extra ? `${c.label}, ${extra}` : c.label}
                        disabled={unavailable}
                        onPress={() => pick(picked > 0 && !one ? 0 : 1)}
                        style={[styles.choice, { borderColor: picked > 0 ? colors.focus : colors.fieldBorder, borderRadius: radii.button }]}
                      >
                        {c.photoUrl ? <Image source={{ uri: c.photoUrl }} accessibilityIgnoresInvertColors style={styles.photo} /> : null}
                        <Text style={{ color: unavailable ? colors.muted : colors.text, fontSize: 16, flex: 1 }}>{c.label}</Text>
                        {extra ? <Text style={{ color: colors.muted, fontSize: 14 }}>{extra}</Text> : null}
                      </Pressable>
                      {!one && c.maxQuantity > 1 && picked > 0 ? (
                        <View style={styles.stepper}>
                          <Pressable accessibilityRole="button" accessibilityLabel={t('customise.quantityLess', { name: c.label })} onPress={() => pick(picked - 1)} style={styles.step}>
                            <Text style={{ color: colors.text, fontSize: 20 }}>−</Text>
                          </Pressable>
                          <Text style={{ color: colors.text, fontSize: 16, minWidth: 20, textAlign: 'center' }}>{picked}</Text>
                          <Pressable accessibilityRole="button" accessibilityLabel={t('customise.quantityMore', { name: c.label })} accessibilityState={{ disabled: picked >= c.maxQuantity }} disabled={picked >= c.maxQuantity} onPress={() => pick(picked + 1)} style={styles.step}>
                            <Text style={{ color: colors.text, fontSize: 20 }}>+</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  )
                })
              : null}
            {q.kind === 'TEXT' ? (
              <>
                <TextInput
                  accessibilityLabel={q.label}
                  value={a?.text ?? ''}
                  onChangeText={(value) => set(q.id, { text: value })}
                  maxLength={q.maxLength}
                  multiline={q.multiline}
                  placeholder={q.example ?? undefined}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { color: colors.text, borderColor: colors.fieldBorder, borderRadius: radii.button, minHeight: q.multiline ? 88 : 48 }]}
                />
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {t('customise.characters', { count: [...(a?.text ?? '')].length, max: q.maxLength })}
                  {q.price ? ` · ${extraText(q.price) ?? ''}` : ''}
                </Text>
              </>
            ) : null}
            {q.kind === 'UPLOAD' ? (
              <>
                {rows.map((f) => (
                  <View key={f.key} style={styles.row}>
                    <Text style={{ color: colors.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
                      {f.name}
                    </Text>
                    {f.failed ? (
                      <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14, flex: 2 }}>
                        {t(f.failed)}
                      </Text>
                    ) : f.id ? null : (
                      <Text accessibilityLiveRegion="polite" style={{ color: colors.muted, fontSize: 14 }}>
                        {t('customise.uploading', { percent: Math.round(f.percent * 100) })}
                      </Text>
                    )}
                    <Pressable accessibilityRole="button" accessibilityLabel={t('customise.remove', { name: f.name })} onPress={() => removeRow(q, f)} style={styles.step}>
                      <Text style={{ color: colors.link, fontSize: 15 }}>✕</Text>
                    </Pressable>
                  </View>
                ))}
                {rows.filter((f) => !f.failed).length < q.maxFiles ? (
                  <View style={styles.actions}>
                    {q.accept !== 'PDF' ? <Button kind="secondary" label={t('customise.addPhoto')} onPress={() => void pickPhoto(q, false)} /> : null}
                    {q.accept !== 'PDF' ? <Button kind="secondary" label={t('customise.takePhoto')} onPress={() => void pickPhoto(q, true)} /> : null}
                    {q.accept !== 'IMAGE' ? <Button kind="secondary" label={t('customise.addFile')} onPress={() => void pickFile(q)} /> : null}
                  </View>
                ) : null}
                {refused ? (
                  <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
                    {t(refused)}
                  </Text>
                ) : null}
                {q.price ? <Text style={{ color: colors.muted, fontSize: 13 }}>{extraText(q.price)}</Text> : null}
              </>
            ) : null}
          </View>
        )
      })}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  question: { gap: 8, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12, borderWidth: 1 },
  photo: { width: 36, height: 36, borderRadius: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  actions: { gap: 8 },
  footer: { gap: 10 },
  total: { flexDirection: 'row', justifyContent: 'space-between' },
})
