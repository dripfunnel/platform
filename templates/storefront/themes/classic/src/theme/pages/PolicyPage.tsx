import { Link, useLocation, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'

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
      if (block.startsWith('## ')) return <h2 key={i} className="mt-3 mr-0 mb-0 ml-0 text-ink font-heading text-[22px] font-[var(--heading-weight)] leading-[1.3]">{block.slice(3)}</h2>
      if (lines.every((l) => l.startsWith('- '))) return <ul key={i} className="pl-6 m-0 flex flex-col gap-y-2 gap-x-2 [&_li::marker]:text-taupe-text">{lines.map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul>
      if (lines.every((l) => numbered.test(l))) return <ol key={i} className="pl-6 m-0 flex flex-col gap-y-2 gap-x-2 [&_li::marker]:text-taupe-text">{lines.map((l, j) => <li key={j}>{l.replace(numbered, '')}</li>)}</ol>
      return <p key={i} className="m-0 wrap-anywhere">{block}</p>
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
      <header className="py-12 px-4 border-b border-b-[rgb(179_165_147_/_30%)] flex flex-col items-center gap-y-4 gap-x-4 bg-[rgb(242_239_234_/_40%)] text-center min-[900px]:py-16 min-[900px]:px-8">
        <h1 className="m-0 text-accent font-heading text-[30px] font-[var(--heading-weight)] leading-[1.2] wrap-anywhere [text-wrap:balance] min-[900px]:text-[36px]">{page ? page.title : t('pages.policy.title')}</h1>
        <span className="w-16 h-px bg-taupe" />
      </header>
      <article className="py-12 px-4 flex box-border w-[min(100%,768px)] flex-col gap-y-5 gap-x-5 mx-auto text-muted text-[16px] leading-[1.75] min-[900px]:py-16 min-[900px]:px-8">
        {page?.body ? (
          <Blocks text={page.body} />
        ) : (
          <>
            <p className="m-0 wrap-anywhere">{kind ? t('pages.policy.ask') : t('pages.policy.lead')}</p>
            <Link href="/contact/" className="py-0 px-5.5 inline-flex min-h-11 self-start items-center rounded-button bg-accent text-accent-ink font-semibold no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
              {t('pages.contact.title')}
            </Link>
          </>
        )}
      </article>
    </Layout>
  )
}
