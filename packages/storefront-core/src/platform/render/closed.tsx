import { createI18n } from '../i18n/i18n'

/** The code `/shop-api` answers on a preview host once its session has ended (PREVIEW §5 step 3). */
export const previewClosedCode = 'PREVIEW_CLOSED'

/** What a preview shows once its session has ended: core's words and no store data (PREVIEW §5 step 3, #520). */
export const PreviewClosed = ({ locale }: { locale: string }) => {
  const { t } = createI18n(locale)
  return (
    <main>
      <h1>{t('preview.closed.title')}</h1>
      <p>{t('preview.closed.body')}</p>
    </main>
  )
}
