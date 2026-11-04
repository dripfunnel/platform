import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../../components/Layout'
import { PageIntro } from '../../components/PageIntro'

export const ResetPasswordPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <PageIntro title={t('pages.resetPassword.title')} lead={t('pages.resetPassword.lead')}>
        <Link href="/sign-in/" className="py-0 px-5.5 inline-flex min-h-12 items-center rounded-button bg-accent text-accent-ink font-semibold no-underline hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
          {t('pages.resetPassword.action')}
        </Link>
      </PageIntro>
    </Layout>
  )
}
