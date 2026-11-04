import type { ReactNode } from 'react'
import { Image, Link, useCollections, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { Ornament } from '../components/Ornament'
import { clsx } from 'clsx'

const Value = ({ title, body, children }: { title: string; body: string; children: ReactNode }) => (
  <li className="p-6 border border-[rgb(179_165_147_/_30%)] flex flex-col items-center gap-y-3 gap-x-3 rounded-[16px] bg-surface [box-shadow:0_1px_2px_rgb(38_34_31_/_6%)] text-center [transition:transform_0.3s_ease] hover:[transform:translateY(-4px)]">
    <span className="inline-flex w-14 h-14 box-border items-center justify-center rounded-full bg-soft [box-shadow:0_0_0_1px_rgb(179_165_147_/_40%)] text-accent [&_svg]:w-6 [&_svg]:h-6 [&_svg]:[fill:none] [&_svg]:[stroke:currentcolor] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.75]" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {children}
      </svg>
    </span>
    <h3 className="mt-1 mr-0 mb-0 ml-0 text-accent font-heading text-[20px] font-[var(--heading-weight)]">{title}</h3>
    <p className="m-0 text-muted text-[14px] leading-[1.6]">{body}</p>
  </li>
)

export const AboutPage = () => {
  const { store, t } = useStorefront()
  const { collections } = useCollections({ first: 20 })
  const storyImage = collections[0]?.image ?? null
  const detailImage = collections[1]?.image ?? null
  const address = store.address ? [store.address.street, store.address.city, store.address.region, store.address.postal].filter(Boolean).join(', ') : ''
  const whatsapp = store.social.find((s) => s.network === 'whatsapp')
  const visit = address || store.contactPhone || store.contactEmail
  return (
    <Layout>
      <section className="py-14 px-4 flex flex-col items-center [background:radial-gradient(rgb(179_165_147_/_25%)_1px,transparent_1.6px)_0_0_/_22px_22px,var(--color-accent)] text-accent-ink text-center min-[900px]:py-20 min-[900px]:px-8">
        <p className="m-0 text-taupe text-[12px] tracking-[0.3em] uppercase">{t('pages.about.eyebrow')}</p>
        <h1 className="mt-3 mr-0 mb-0 ml-0 font-heading text-[32px] font-[var(--heading-weight)] leading-[1.15] wrap-anywhere [text-wrap:balance] min-[900px]:text-[48px]">{t('pages.about.title', { store: store.name })}</h1>
        <Ornament className="mt-5 block w-[min(100%,192px)] h-2.5 text-taupe" />
        <p className="mt-5 mr-0 mb-0 ml-0 max-w-[42rem] text-[rgb(250_249_247_/_80%)] text-[15px] leading-[1.7] [text-wrap:balance] wrap-anywhere min-[900px]:text-[16px]">{t('pages.about.lead', { store: store.name })}</p>
      </section>
      <div className="border-t-[2px] border-t-taupe h-3 box-border [background:conic-gradient(from_135deg_at_50%_0,var(--color-taupe)_90deg,transparent_0)_bottom_/_16px_8px_repeat-x,var(--color-deep)]" />
      <section className="py-16 px-4 grid box-border w-[min(100%,1240px)] items-center gap-y-14 gap-x-14 grid-cols-[minmax(0,1fr)] mx-auto min-[768px]:py-24 min-[768px]:px-8 min-[768px]:gap-y-16 min-[768px]:gap-x-16 min-[768px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative w-[min(100%,448px)] mx-auto [&::before]:border [&::before]:border-[rgb(179_165_147_/_60%)] [&::before]:absolute [&::before]:inset-0 [&::before]:[border-radius:999px_999px_12px_12px] [&::before]:[content:''] [&::before]:[transform:translate(12px,12px)] min-[768px]:[&::before]:[transform:translate(16px,16px)]">
          <div className={clsx('relative overflow-hidden aspect-[4/5] [border-radius:999px_999px_12px_12px] [box-shadow:0_0_0_1px_rgb(179_165_147_/_40%)]', 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', '[background-image:linear-gradient(160deg,#8a8178,#4a4541)] [background-position:center_25%]')}>
            {storyImage ? <Image image={storyImage} alt="" ratio={0.8} sizes="(min-width: 900px) 448px, 100vw" className="absolute inset-0 block w-full h-full object-cover" /> : null}
          </div>
          <div className={clsx('border-[4px] border-bg absolute -bottom-6 -left-4 overflow-hidden w-28 h-28 rounded-full [box-shadow:0_0_0_1px_rgb(179_165_147_/_50%),0_12px_28px_rgb(42_39_37_/_18%)] min-[768px]:-left-8 min-[768px]:w-36 min-[768px]:h-36', 'bg-soft [background-position:center] [background-repeat:no-repeat] [background-size:cover]', '[background-image:linear-gradient(160deg,#a39482,#5e554b)]')}>
            {detailImage ? <Image image={detailImage} alt="" ratio={1} sizes="144px" className="absolute inset-0 block w-full h-full object-cover" /> : null}
          </div>
        </div>
        <div className="flex flex-col gap-y-5 gap-x-5 min-w-0">
          <p className="m-0 text-accent text-[12px] font-semibold tracking-[0.25em] uppercase">{t('pages.about.story.eyebrow')}</p>
          <h2 className="m-0 font-heading text-[30px] font-[var(--heading-weight)] leading-[1.15] [text-wrap:balance] min-[900px]:text-[36px]">
            {t('pages.about.story.title')} <em className="text-taupe-text">{t('pages.about.story.accent')}</em>
          </h2>
          <p className="m-0 text-muted text-[17px] leading-[1.75] wrap-anywhere">{t('pages.about.story.first', { store: store.name })}</p>
          <p className="m-0 text-muted text-[15px] leading-[1.75] wrap-anywhere">{t('pages.about.story.second')}</p>
        </div>
      </section>
      <section className="py-16 px-4 [border-block:1px_solid_rgb(179_165_147_/_25%)] [background:radial-gradient(rgb(179_165_147_/_30%)_1px,transparent_1.6px)_0_0_/_22px_22px,rgb(242_239_234_/_40%)] min-[900px]:py-20 min-[900px]:px-8">
        <div className="my-0 mx-auto flex max-w-[42rem] flex-col items-center gap-y-4 gap-x-4 text-center">
          <p className="m-0 text-accent text-[12px] font-semibold tracking-[0.25em] uppercase">{t('pages.about.promise.eyebrow')}</p>
          <h2 className="m-0 font-heading text-[30px] font-[var(--heading-weight)] leading-[1.15] [text-wrap:balance] min-[900px]:text-[36px]">{t('pages.about.promise.title')}</h2>
          <p className="m-0 text-muted text-[15px] leading-[1.75] wrap-anywhere">{t('pages.about.promise.body')}</p>
        </div>
        <ul className="p-0 mt-12 mr-auto mb-0 ml-auto grid max-w-[1080px] gap-y-6 gap-x-6 grid-cols-[minmax(0,1fr)] list-none min-[640px]:grid-cols-[repeat(3,minmax(0,1fr))]">
          <Value title={t('pages.about.promise.designs.title')} body={t('pages.about.promise.designs.body')}>
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M21 5h-4M5 17v4M7 19H3" />
          </Value>
          <Value title={t('pages.about.promise.quality.title')} body={t('pages.about.promise.quality.body')}>
            <path d="M6 3h12l4 6-10 12L2 9zM2 9h20M12 21L8 9l4-6 4 6z" />
          </Value>
          <Value title={t('pages.about.promise.service.title')} body={t('pages.about.promise.service.body')}>
            <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10zM8.5 11.5l2 2 3.5-3.5" />
          </Value>
        </ul>
      </section>
      {visit ? (
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
              {address ? <p className="-mt-2 mr-0 mb-0 ml-0 text-muted leading-[1.7]">{address}</p> : null}
              <ul className="p-0 m-0 flex flex-col gap-y-2.5 gap-x-2.5 text-[14px] list-none">
                {store.contactPhone ? <li className="wrap-anywhere">{store.contactPhone}</li> : null}
                {store.contactEmail ? <li className="wrap-anywhere">{store.contactEmail}</li> : null}
              </ul>
              {whatsapp ? (
                <Link href={whatsapp.url} className="py-0 px-5 inline-flex min-h-11 items-center rounded-full bg-accent text-accent-ink text-[14px] font-semibold no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                  {t('pages.about.visit.whatsapp')}
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <div className={clsx('border-t-[2px] border-t-taupe h-3 box-border [background:conic-gradient(from_135deg_at_50%_0,var(--color-taupe)_90deg,transparent_0)_bottom_/_16px_8px_repeat-x,var(--color-deep)]', '[transform:scaleY(-1)]')} />
      <section className="py-12 px-4 bg-accent text-accent-ink min-[900px]:py-14 min-[900px]:px-8">
        <p className="my-0 mx-auto max-w-[900px] font-heading text-[24px] italic text-center [text-wrap:balance] wrap-anywhere min-[900px]:text-[30px]">{t('pages.about.closing', { store: store.name })}</p>
      </section>
    </Layout>
  )
}
