import { t } from '../../messages'
import type { TemplateWords } from './sizeChartDraft'

/** The templates' column and size-system names, in the app's words, so a chart starts in them. */
export const templateWords = (): TemplateWords => ({
  columns: {
    chest: t('collections.charts.columns.chest'),
    waist: t('collections.charts.columns.waist'),
    length: t('collections.charts.columns.length'),
    bust: t('collections.charts.columns.bust'),
    foot: t('collections.charts.columns.foot'),
    shoulder: t('collections.charts.columns.shoulder'),
    leg: t('collections.charts.columns.leg'),
    measurement: t('collections.charts.columns.measurement'),
  },
  systems: { uk: t('collections.charts.systems.uk'), eu: t('collections.charts.systems.eu'), jp: t('collections.charts.systems.jp') },
})
