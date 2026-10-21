import { Link, useLocation, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import styles from '../styles/shop.module.css'

const kinds = ['terms', 'privacy', 'shipping', 'returns', 'legal'] as const
type Kind = (typeof kinds)[number]

// The Shop API serves no policy text yet, so the page names the policy and how to ask about it (card #307).
export const PolicyPage = () => {
  const { t } = useStorefront()
  const { path } = useLocation()
  const kind = kinds.find((k) => path === `/policies/${k}/` || path === `/policies/${k}`)
  const names: Record<Kind, string> = { terms: t('pages.policy.terms'), privacy: t('pages.policy.privacy'), shipping: t('pages.policy.shipping'), returns: t('pages.policy.returns'), legal: t('pages.policy.legal') }
  return (
    <Layout>
      <section className={styles.page}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>{t('pages.policy.eyebrow')}</p>
          <h1 className={styles.title}>{kind ? names[kind] : t('pages.policy.title')}</h1>
          <p className={styles.lead}>{kind ? t('pages.policy.ask') : t('pages.policy.lead')}</p>
        </header>
        <Link href="/contact/" className={styles.secondary}>
          {t('pages.contact.title')}
        </Link>
        <nav className={styles.chips} aria-label={t('pages.policy.eyebrow')}>
          {kinds.map((k) =>
            k === kind ? (
              <span key={k} className={styles.chipOn} aria-current="page">
                {names[k]}
              </span>
            ) : (
              <Link key={k} href={`/policies/${k}/`} className={styles.chipLink}>
                {names[k]}
              </Link>
            ),
          )}
        </nav>
      </section>
    </Layout>
  )
}
