import { useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'

export const ContactPage = () => {
  const { store, t } = useStorefront()
  const place = [store.address?.street, store.address?.city, store.address?.region, store.address?.postal].filter(Boolean).join(', ')
  return (
    <Layout>
      <header className="py-12 px-4 border-b border-b-[rgb(179_165_147_/_30%)] flex flex-col items-center gap-y-4 gap-x-4 bg-[rgb(242_239_234_/_40%)] text-center min-[900px]:py-16 min-[900px]:px-8">
        <h1 className="m-0 text-accent font-heading text-[30px] font-[var(--heading-weight)] leading-[1.2] wrap-anywhere [text-wrap:balance] min-[900px]:text-[36px]">{t('pages.contact.title')}</h1>
        <span className="w-16 h-px bg-taupe" />
        <p className="m-0 max-w-[56ch] text-ink-soft text-[16px]">{t('pages.contact.lead')}</p>
      </header>
      <section className="py-16 px-4 min-[768px]:py-24 min-[768px]:px-8">
        <div className="my-0 mx-auto border border-[rgb(179_165_147_/_40%)] grid overflow-hidden max-w-[900px] grid-cols-[minmax(0,1fr)] rounded-[24px] bg-surface [box-shadow:0_1px_2px_rgb(38_34_31_/_6%)] min-[768px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="p-8 flex flex-col items-center justify-center gap-y-4 gap-x-4 [background:radial-gradient(rgb(179_165_147_/_20%)_1px,transparent_1.6px)_0_0_/_22px_22px,var(--color-accent)] text-accent-ink text-center min-[768px]:p-10">
            <span className="[&_svg]:[fill:none] [&_svg]:[stroke:currentcolor] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.75] [&_svg]:w-10 [&_svg]:h-10 inline-flex w-24 h-24 box-border items-center justify-center rounded-full bg-[rgb(250_249_247_/_10%)] [box-shadow:0_0_0_1px_rgb(179_165_147_/_60%)] text-taupe" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M4 10h16M5 10l1-5h12l1 5M5 10v10h14V10M9 20v-5h6v5" />
              </svg>
            </span>
            <h2 className="m-0 font-heading text-[26px] font-[var(--heading-weight)]">{t('pages.about.visit.title')}</h2>
            <p className="m-0 text-[rgb(250_249_247_/_75%)] text-[14px]">{t('pages.about.visit.lead')}</p>
          </div>
          <div className="p-8 flex flex-col items-start gap-y-4 gap-x-4 min-w-0 min-[768px]:p-10">
            <p className="m-0 text-accent font-heading text-[20px] font-[var(--heading-weight)] wrap-anywhere">{store.name}</p>
            <dl className="mt-2 mr-0 mb-0 ml-0 grid gap-y-3.5 gap-x-3.5">
              {store.contactEmail ? (
                <div className="flex flex-col">
                  <dt className="text-muted text-[12px] tracking-[0.08em] uppercase">{t('pages.contact.email')}</dt>
                  <dd className="m-0 text-[16px] wrap-anywhere">{store.contactEmail}</dd>
                </div>
              ) : null}
              {store.contactPhone ? (
                <div className="flex flex-col">
                  <dt className="text-muted text-[12px] tracking-[0.08em] uppercase">{t('pages.contact.phone')}</dt>
                  <dd className="m-0 text-[16px] wrap-anywhere">{store.contactPhone}</dd>
                </div>
              ) : null}
              {place ? (
                <div className="flex flex-col">
                  <dt className="text-muted text-[12px] tracking-[0.08em] uppercase">{t('pages.contact.visit')}</dt>
                  <dd className="m-0 text-[16px] wrap-anywhere">{place}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </section>
    </Layout>
  )
}
