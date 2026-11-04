import { Link, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'

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
      <header className="py-12 px-4 border-b border-b-[rgb(179_165_147_/_30%)] flex flex-col items-center gap-y-4 gap-x-4 bg-[rgb(242_239_234_/_40%)] text-center min-[900px]:py-16 min-[900px]:px-8">
        <h1 className="m-0 text-accent font-heading text-[30px] font-[var(--heading-weight)] leading-[1.2] wrap-anywhere [text-wrap:balance] min-[900px]:text-[36px]">{t('faq.title')}</h1>
        <span className="w-16 h-px bg-taupe" />
      </header>
      <div className="py-12 px-4 flex box-border w-[min(100%,768px)] flex-col gap-y-10 gap-x-10 mx-auto min-[900px]:py-16 min-[900px]:px-8">
        {groupsOf(body).map((group) => (
          <section key={group.title}>
            <h2 className="mt-0 mr-0 mb-2 ml-0 text-accent font-heading text-[22px] font-[var(--heading-weight)] min-[900px]:text-[26px]">{group.title}</h2>
            <div className="[border-block:1px_solid_rgb(179_165_147_/_20%)]">
              {group.items.map((item) => (
                <details key={item.question} className="group/faq-item not-first:border-t not-first:border-t-[rgb(179_165_147_/_20%)]">
                  <summary className="py-3 px-0 flex min-h-13 items-center justify-between gap-y-4 gap-x-4 text-ink text-[16px] font-medium cursor-pointer list-none [&::marker]:text-[0] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                    {item.question}
                    <svg className="w-4.5 h-4.5 shrink-0 [fill:none] [stroke:var(--color-muted)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2] [transition:transform_0.2s_ease] group-[[open]]/faq-item:[transform:rotate(180deg)]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </summary>
                  <div className="pb-4 flex flex-col gap-y-3 gap-x-3 text-muted text-[16px] leading-[1.75]">
                    {item.answer.map((line) => (
                      <p key={line} className="m-0 wrap-anywhere">
                        {line}
                      </p>
                    ))}
                    {item.link ? (
                      <Link href={item.link.href} className="self-start text-accent font-semibold underline-offset-[3px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                        {item.link.label}
                      </Link>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
        <section className="p-6 border border-[rgb(179_165_147_/_30%)] flex flex-col items-center gap-y-2 gap-x-2 rounded-card bg-[rgb(242_239_234_/_40%)] text-center min-[900px]:p-8">
          <h2 className="m-0 text-accent font-heading text-[22px] font-[var(--heading-weight)]">{t('faq.more.title')}</h2>
          <p className="m-0 text-muted">{t('faq.more.lead')}</p>
          {store.contactPhone || store.contactEmail ? (
            <ul className="p-0 mt-3 mr-0 mb-0 ml-0 flex flex-wrap justify-center gap-y-3 gap-x-6 text-[14px] list-none wrap-anywhere">
              {store.contactPhone ? <li>{store.contactPhone}</li> : null}
              {store.contactEmail ? <li>{store.contactEmail}</li> : null}
            </ul>
          ) : (
            <Link href="/contact/" className="self-start text-accent font-semibold underline-offset-[3px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('pages.contact.title')}
            </Link>
          )}
        </section>
      </div>
    </Layout>
  )
}
