import type { ReactNode } from 'react'
import { Image, Link, useCollections, useStorefront } from '@dripfunnel/storefront-core/theme'
import { Layout } from '../components/Layout'
import { Ornament } from '../components/Ornament'
import { cx } from '../components/cx'
import art from '../styles/art.module.css'
import home from '../styles/home.module.css'
import styles from '../styles/about.module.css'

const Value = ({ title, body, children }: { title: string; body: string; children: ReactNode }) => (
  <li className={styles.value}>
    <span className={styles.valueIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {children}
      </svg>
    </span>
    <h3 className={styles.valueTitle}>{title}</h3>
    <p className={styles.valueBody}>{body}</p>
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
      <section className={styles.hero}>
        <p className={styles.heroEyebrow}>{t('pages.about.eyebrow')}</p>
        <h1 className={styles.heroTitle}>{t('pages.about.title', { store: store.name })}</h1>
        <Ornament className={styles.heroOrnament} />
        <p className={styles.heroLead}>{t('pages.about.lead', { store: store.name })}</p>
      </section>
      <div className={home.templeBorder} />
      <section className={styles.story}>
        <div className={styles.storyPictures}>
          <div className={cx(styles.arch, art.art, art.stone)}>
            {storyImage ? <Image image={storyImage} alt="" ratio={0.8} sizes="(min-width: 900px) 448px, 100vw" className={home.cover} /> : null}
          </div>
          <div className={cx(styles.detail, art.art, art.sand)}>
            {detailImage ? <Image image={detailImage} alt="" ratio={1} sizes="144px" className={home.cover} /> : null}
          </div>
        </div>
        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>{t('pages.about.story.eyebrow')}</p>
          <h2 className={styles.heading}>
            {t('pages.about.story.title')} <em className={styles.accent}>{t('pages.about.story.accent')}</em>
          </h2>
          <p className={styles.lead}>{t('pages.about.story.first', { store: store.name })}</p>
          <p className={styles.body}>{t('pages.about.story.second')}</p>
        </div>
      </section>
      <section className={styles.promise}>
        <div className={styles.promiseHead}>
          <p className={styles.eyebrow}>{t('pages.about.promise.eyebrow')}</p>
          <h2 className={styles.heading}>{t('pages.about.promise.title')}</h2>
          <p className={styles.body}>{t('pages.about.promise.body')}</p>
        </div>
        <ul className={styles.values}>
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
        <section className={styles.visit}>
          <div className={styles.visitCard}>
            <div className={styles.visitPanel}>
              <span className={styles.visitIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M4 10h16M5 10l1-5h12l1 5M5 10v10h14V10M9 20v-5h6v5" />
                </svg>
              </span>
              <h2 className={styles.visitTitle}>{t('pages.about.visit.title')}</h2>
              <p className={styles.visitLead}>{t('pages.about.visit.lead')}</p>
            </div>
            <div className={styles.visitDetails}>
              <p className={styles.visitName}>{store.name}</p>
              {address ? <p className={styles.visitAddress}>{address}</p> : null}
              <ul className={styles.contacts}>
                {store.contactPhone ? <li className={styles.contact}>{store.contactPhone}</li> : null}
                {store.contactEmail ? <li className={styles.contact}>{store.contactEmail}</li> : null}
              </ul>
              {whatsapp ? (
                <Link href={whatsapp.url} className={styles.visitButton}>
                  {t('pages.about.visit.whatsapp')}
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <div className={cx(home.templeBorder, home.templeBorderFlip)} />
      <section className={styles.closing}>
        <p className={styles.closingText}>{t('pages.about.closing', { store: store.name })}</p>
      </section>
    </Layout>
  )
}
