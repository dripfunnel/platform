import { useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '../../../graphql'
import { t, tryT } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { LinkButton } from '../../common/LinkButton'
import { useFeedback } from '../../shell/Feedback'
import { ShellScreen } from '../../states/ShellScreen'
import { EditorBanner, type BannerSpec } from '../editor/EditorBanner'
import { StatusChip } from '../StatusChip'
import { ModuleCard } from './ModuleCard'
import { ModuleForm } from './ModuleForm'
import { ProductPicker } from './ProductPicker'
import type { StoryData } from './loadStory'
import { maxCompared, maxModules, storyKinds, storyTemplates, type StoryTemplate } from './storyDraft'
import { useStory } from './useStory'

type Props = { client: ApiClient; data: StoryData }

type Picking = { kind: 'compare'; moduleId: string } | { kind: 'copy' } | null

// A product's A+ content (CatAPlus at phone width): modules as cards you open to edit, added from a palette or a template, saved
// as a draft and published with the product. Shoppers see nothing until it is published.
export function StoryEditor({ client, data }: Props) {
  const { colors } = useTheme()
  const navigation = useNavigation()
  const feedback = useFeedback()
  const story = useStory(client, data)
  const [picking, setPicking] = useState<Picking>(null)
  const [exit, setExit] = useState<(() => void) | null>(null)

  // Navigation waits for a render that no longer holds the screen back, or the guard would stop its own way out.
  useEffect(() => {
    exit?.()
  }, [exit])

  usePreventRemove(story.dirty && exit === null, ({ data: { action } }) =>
    feedback.menu({
      title: t('products.story.leaveTitle'),
      sub: t('products.story.leave'),
      items: [
        { key: 'keep', label: t('products.leave.keep'), onPress: () => undefined },
        { key: 'discard', label: t('products.leave.discard'), danger: true, onPress: () => setExit(() => () => navigation.dispatch(action)) },
      ],
    }),
  )

  const status = story.dirty ? 'unsaved' : story.story.status
  const tone = status === 'live' ? 'success' : status === 'unsaved' || status === 'changed' ? 'warning' : 'neutral'
  const gapsOf = (id: string) => story.gaps.filter((gap) => gap.moduleId === id)
  const banners: BannerSpec[] = [
    ...(!data.available ? [{ key: 'plan', tone: 'info' as const, title: t('products.aplus.plan') }] : []),
    ...(story.access.readOnlyStore ? [{ key: 'readOnly', tone: 'info' as const, title: t('products.story.readOnly') }] : []),
    ...(story.access.viewOnly && !story.access.readOnlyStore ? [{ key: 'viewOnly', tone: 'info' as const, title: t('products.story.viewOnly') }] : []),
    ...(story.gaps.length > 0 ? [{ key: 'gaps', tone: 'danger' as const, title: tCount('products.story.gaps', story.gaps.length) }] : []),
  ]
  const editable = story.canEdit && data.available

  const palette = () =>
    feedback.menu({
      title: t('products.story.palette'),
      items: storyKinds
        .filter((kind) => !(story.supplier && kind === 'brand'))
        .map((kind) => ({ key: kind, label: `${t(`products.story.kinds.${kind}`)}${kind === 'specs' || kind === 'faq' ? ` · ${t('products.story.kindFromProduct')}` : ''}`, onPress: () => story.add(kind) })),
    })

  const templates = () =>
    feedback.menu({ title: t('products.story.startFrom'), items: (Object.keys(storyTemplates) as StoryTemplate[]).map((key) => ({ key, label: t(`products.story.templates.${key}`), onPress: () => story.applyTemplate(key) })) })

  return (
    <View style={styles.root}>
      <ShellScreen label={t('products.story.title')}>
        <View style={styles.content}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
              {t('products.story.title')}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>{data.productName}</Text>
            <View style={styles.meta}>
              <StatusChip label={t(`products.story.state.${status}`)} tone={tone} />
              <Text style={[styles.sub, { color: colors.muted }]}>{t('products.story.count', { count: story.modules.length, max: maxModules })}</Text>
            </View>
          </View>
          {banners.map((spec) => (
            <EditorBanner key={spec.key} spec={spec} />
          ))}

          {editable ? (
            <View style={styles.tools}>
              <LinkButton label={t('products.story.palette')} onPress={palette} />
              <LinkButton label={t('products.story.startFrom')} onPress={templates} />
              <LinkButton label={t('products.story.copyFrom')} onPress={() => setPicking({ kind: 'copy' })} />
            </View>
          ) : null}

          {story.modules.length === 0 ? <Text style={[styles.empty, { color: colors.muted, borderColor: colors.fieldBorder }]}>{t('products.story.empty')}</Text> : null}
          {story.modules.map((module, i) => {
            const gaps = gapsOf(module.id)
            return (
              <ModuleCard
                key={module.id}
                module={module}
                open={story.open === module.id}
                onToggle={() => story.setOpen(story.open === module.id ? null : module.id)}
                gapWords={gaps.map((gap) => tryT(`products.story.gapFields.${gap.field}`) ?? gap.field)}
                canEdit={editable}
                onUp={i > 0 ? () => story.move(module, -1) : null}
                onDown={i < story.modules.length - 1 ? () => story.move(module, 1) : null}
                onDuplicate={() => story.duplicate(module)}
                onDelete={() => story.remove(module)}
              >
                <ModuleForm
                  module={module}
                  onChange={story.change(module.id)}
                  disabled={!editable}
                  blocks={data.blocks}
                  supplier={story.supplier}
                  names={story.names}
                  gaps={new Set(gaps.map((gap) => gap.field))}
                  onAddProducts={() => setPicking({ kind: 'compare', moduleId: module.id })}
                />
              </ModuleCard>
            )
          })}
        </View>
      </ShellScreen>
      {editable ? (
        <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Button kind="secondary" label={t('products.story.saveDraft')} onPress={() => void story.save()} busy={story.busy} saves />
          <Button label={story.supplier ? t('products.story.submit') : t('products.story.publish')} onPress={() => void story.publish()} busy={story.busy} saves />
        </View>
      ) : null}
      {picking?.kind === 'compare' ? (
        <ProductPicker
          client={client}
          title={t('products.story.compareSearch')}
          max={maxCompared}
          exclude={[data.productId]}
          chosen={story.modules.find((module) => module.id === picking.moduleId)?.productIds ?? []}
          onClose={() => setPicking(null)}
          onPick={(picked) => {
            story.addNames(picked)
            story.change(picking.moduleId)((module) => ({ ...module, productIds: [...module.productIds, ...picked.map((product) => product.id)] }))
            setPicking(null)
          }}
        />
      ) : null}
      {picking?.kind === 'copy' ? (
        <ProductPicker
          client={client}
          title={t('products.story.copySearch')}
          max={1}
          exclude={[data.productId]}
          onClose={() => setPicking(null)}
          onPick={([from]) => {
            setPicking(null)
            if (from) story.copyFrom(from)
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 24 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 14 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  empty: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, padding: 24, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  bar: { padding: 12, gap: 8, borderTopWidth: 1 },
})
