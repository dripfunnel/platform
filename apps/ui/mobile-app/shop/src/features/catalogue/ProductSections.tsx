import { Image } from 'expo-image'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Product, SizeChart, StoryModule } from '../../api/catalogue'
import { t } from '../../messages'
import { Sheet } from '../common/ui'

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.sectionHead}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{title}</Text>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: colors.muted, fontSize: 20 }}>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  )
}

function Body({ text }: { text: string }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.textStrong, fontSize: 14, lineHeight: 21 }}>{text}</Text>
}

function Story({ module }: { module: StoryModule }) {
  const { colors, radii } = useTheme()
  const photos = module.photos
  if (!module.title && !module.body && photos.length === 0 && module.items.length === 0) return null
  return (
    <View style={styles.story}>
      {photos.map((photo) => (
        <View key={photo.url} style={[styles.storyPhoto, { backgroundColor: colors.skeleton, borderRadius: radii.card }]}>
          <Image source={{ uri: photo.url }} {...(photo.alt ? { accessibilityLabel: photo.alt } : {})} accessibilityIgnoresInvertColors contentFit="cover" style={StyleSheet.absoluteFill} />
        </View>
      ))}
      {module.title ? (
        <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 20, fontWeight: '700' }}>
          {module.title}
        </Text>
      ) : null}
      {module.body ? <Body text={module.body} /> : null}
      {module.items.map((item, i) => (
        <View key={i} style={styles.storyItem}>
          {item.title ? <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{item.title}</Text> : null}
          {item.text ? <Body text={item.text} /> : null}
        </View>
      ))}
    </View>
  )
}

function SizeChartTable({ chart }: { chart: SizeChart }) {
  const { colors } = useTheme()
  const cell = (text: string, key: string, strong = false) => (
    <Text key={key} style={[styles.cell, { color: strong ? colors.text : colors.textStrong, fontWeight: strong ? '700' : '500' }]}>
      {text}
    </Text>
  )
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>{[t('product.sizeChart.size'), ...chart.measurements].map((name, i) => cell(name, `h${i}`, true))}</View>
      {chart.rows.map((row) => (
        <View key={row.size} style={[styles.tableRow, { borderColor: colors.border }]}>
          {[row.size, ...row.values].map((value, i) => cell(value, `${row.size}${i}`, i === 0))}
        </View>
      ))}
      {chart.unit ? <Text style={{ color: colors.muted, fontSize: 13 }}>{chart.unit}</Text> : null}
      {chart.fitNotes ? <Body text={chart.fitNotes} /> : null}
      {chart.modelInfo ? <Body text={chart.modelInfo} /> : null}
    </View>
  )
}

/** The store's own words for a product, as the API gives them: highlights, details, specifications, returns, questions, its story and its size chart. */
export function ProductSections({ product, versionId }: { product: Product; versionId: string | null }) {
  const { colors } = useTheme()
  const [chartOpen, setChartOpen] = useState(false)
  const specs = product.specs.filter((spec) => spec.versionId === null || spec.versionId === versionId)
  const delivery = [product.returns, product.warranty ? t('product.warranty', { text: product.warranty }) : null].filter((text): text is string => Boolean(text))

  return (
    <View style={styles.all}>
      {product.highlights.length > 0 ? (
        <View style={styles.highlights}>
          {product.highlights.map((line) => (
            <Text key={line} style={{ color: colors.textStrong, fontSize: 14 }}>
              •  {line}
            </Text>
          ))}
        </View>
      ) : null}
      {product.sizeChart ? (
        <Pressable accessibilityRole="button" onPress={() => setChartOpen(true)} style={styles.chartLink}>
          <Text style={{ color: colors.link, fontWeight: '700', fontSize: 14, textDecorationLine: 'underline' }}>{t('product.sizeChart.open')}</Text>
        </Pressable>
      ) : null}
      <View style={[styles.sections, { borderColor: colors.border }]}>
        {product.description ? (
          <Section title={t('product.sections.details')}>
            <Body text={product.description} />
          </Section>
        ) : null}
        {specs.length > 0 ? (
          <Section title={t('product.sections.specs')}>
            {specs.map((spec) => (
              <View key={`${spec.name}${spec.versionId}`} style={styles.spec}>
                <Text style={{ color: colors.muted, fontSize: 14, flex: 1 }}>{spec.name}</Text>
                <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{spec.value}</Text>
              </View>
            ))}
          </Section>
        ) : null}
        {delivery.length > 0 ? (
          <Section title={t('product.sections.returns')}>
            {delivery.map((text) => (
              <Body key={text} text={text} />
            ))}
          </Section>
        ) : null}
        {product.faqs.length > 0 ? (
          <Section title={t('product.sections.faqs')}>
            {product.faqs.map((faq) => (
              <View key={faq.question} style={styles.faq}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{faq.question}</Text>
                <Body text={faq.answer} />
              </View>
            ))}
          </Section>
        ) : null}
      </View>
      {product.story.map((module) => (
        <Story key={module.id} module={module} />
      ))}
      {chartOpen && product.sizeChart ? (
        <Sheet title={product.sizeChart.name ?? t('product.sizeChart.open')} onClose={() => setChartOpen(false)}>
          <SizeChartTable chart={product.sizeChart} />
        </Sheet>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  all: { gap: 16 },
  highlights: { gap: 4 },
  chartLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  sections: { borderTopWidth: 1 },
  section: { borderBottomWidth: 1 },
  sectionHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionBody: { gap: 8, paddingBottom: 14 },
  spec: { flexDirection: 'row', gap: 12 },
  faq: { gap: 2 },
  story: { gap: 10 },
  storyPhoto: { aspectRatio: 3 / 2, overflow: 'hidden' },
  storyItem: { gap: 2 },
  table: { gap: 6, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  cell: { flex: 1, fontSize: 14 },
})
