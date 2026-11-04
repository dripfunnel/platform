import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import policy from '../styles/policy.module.css'
import styles from '../styles/faq.module.css'

const linkLine = /^\[(.+)\]\((\/[^)]*)\)$/

type Group = { title: string; items: { question: string; answer: string[]; link: { label: string; href: string } | null }[] }

/**
 * The FAQ from content: blocks split by a blank line, '## ' starting a group, and a question
 * block being 'Q: question', its answer lines, then an optional '[label](address)' line.
 */
const groupsOf = (text: string): Group[] =>
  text.split('\n\n').reduce<Group[]>((groups, block) => {
    if (block.startsWith('## ')) return [...groups, { title: block.slice(3), items: [] }]
    const [first = '', ...rest] = block.split('\n')
    const match = linkLine.exec(rest.at(-1) ?? '')
    const item = { question: first.replace(/^Q:\s*/, ''), answer: match ? rest.slice(0, -1) : rest, link: match ? { label: match[1] ?? '', href: match[2] ?? '/' } : null }
    const last = groups.at(-1)
    return last ? [...groups.slice(0, -1), { ...last, items: [...last.items, item] }] : groups
  }, [])

export const FaqPage = () => {
  const { store, t } = useStorefront()
  const body = t('faq.body')
  return (
    <Layout>
      <header className={policy.band}>
        <h1 className={policy.title}>{t('faq.title')}</h1>
        <span className={policy.rule} />
      </header>
      <div className={styles.page}>
        {groupsOf(body).map((group) => (
          <section key={group.title}>
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <div className={styles.items}>
              {group.items.map((item) => (
                <details key={item.question} className={styles.item}>
                  <summary className={styles.question}>
                    {item.question}
                    <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </summary>
                  <div className={styles.answer}>
                    {item.answer.map((line) => (
                      <p key={line} className={styles.line}>
                        {line}
                      </p>
                    ))}
                    {item.link ? (
                      <Link href={item.link.href} className={styles.link}>
                        {item.link.label}
                      </Link>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
        <section className={styles.more}>
          <h2 className={styles.moreTitle}>{t('faq.more.title')}</h2>
          <p className={styles.moreLead}>{t('faq.more.lead')}</p>
          {store.contactPhone || store.contactEmail ? (
            <ul className={styles.contacts}>
              {store.contactPhone ? <li>{store.contactPhone}</li> : null}
              {store.contactEmail ? <li>{store.contactEmail}</li> : null}
            </ul>
          ) : (
            <Link href="/contact/" className={styles.link}>
              {t('pages.contact.title')}
            </Link>
          )}
        </section>
      </div>
    </Layout>
  )
}
