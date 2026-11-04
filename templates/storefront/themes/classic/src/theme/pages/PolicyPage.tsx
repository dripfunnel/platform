import { Link, useLocation, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import styles from '../styles/policy.module.css'

const kinds = ['terms', 'privacy', 'shipping', 'returns', 'legal'] as const
type Kind = (typeof kinds)[number]

const numbered = /^\d+\.\s/

/**
 * A policy's text from content: blocks split by a blank line, '## ' starting a heading,
 * and lines after '- ' or 'n. ' forming a list.
 */
const Blocks = ({ text }: { text: string }) => (
  <>
    {text.split('\n\n').map((block, i) => {
      const lines = block.split('\n')
      if (block.startsWith('## ')) return <h2 key={i} className={styles.heading}>{block.slice(3)}</h2>
      if (lines.every((l) => l.startsWith('- '))) return <ul key={i} className={styles.list}>{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>
      if (lines.every((l) => numbered.test(l))) return <ol key={i} className={styles.list}>{lines.map((l, j) => <li key={j}>{l.replace(numbered, '')}</li>)}</ol>
      return <p key={i} className={styles.paragraph}>{block}</p>
    })}
  </>
)

export const PolicyPage = () => {
  const { t } = useStorefront()
  const { path } = useLocation()
  const kind = kinds.find((k) => path === `/policies/${k}/` || path === `/policies/${k}`)
  const pages: Record<Kind, { title: string; body: string }> = {
    terms: { title: t('policies.terms.title'), body: t('policies.terms.body') },
    privacy: { title: t('policies.privacy.title'), body: t('policies.privacy.body') },
    shipping: { title: t('policies.shipping.title'), body: t('policies.shipping.body') },
    returns: { title: t('policies.returns.title'), body: t('policies.returns.body') },
    legal: { title: t('pages.policy.legal'), body: '' },
  }
  const page = kind ? pages[kind] : null
  return (
    <Layout>
      <header className={styles.band}>
        <h1 className={styles.title}>{page ? page.title : t('pages.policy.title')}</h1>
        <span className={styles.rule} />
      </header>
      <article className={styles.article}>
        {page?.body ? (
          <Blocks text={page.body} />
        ) : (
          <>
            <p className={styles.paragraph}>{kind ? t('pages.policy.ask') : t('pages.policy.lead')}</p>
            <Link href="/contact/" className={styles.contact}>
              {t('pages.contact.title')}
            </Link>
          </>
        )}
      </article>
    </Layout>
  )
}
