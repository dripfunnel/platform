import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'

export const AboutPage = () => {
  const { t } = useStorefront()
  return (
    <Layout>
      <section className="grid box-border grid-cols-[minmax(0,1fr)] w-[min(100%,1240px)] gap-y-6 gap-x-6 mx-auto min-[900px]:items-start min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="pt-10 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col items-start gap-y-3.5 gap-x-3.5 mx-auto min-[900px]:pt-14 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
          <h1 className="m-0 max-w-[22ch] font-heading text-[32px] font-[var(--heading-weight)] tracking-[-0.01em] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[40px]">{t('pages.about.title')}</h1>
          <p className="m-0 max-w-[56ch] text-ink-soft text-[16px]">{t('pages.about.first')}</p>
          <p className="m-0 max-w-[56ch] text-ink-soft text-[16px]">{t('pages.about.second')}</p>
        </div>
        <div className="min-h-70 mx-4 rounded-card [background:var(--picture-alt)] min-[900px]:mt-14 min-[900px]:mr-8 min-[900px]:mb-0 min-[900px]:ml-0 min-[900px]:min-h-120" />
      </section>
    </Layout>
  )
}
