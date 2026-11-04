'use client'

import { useState } from 'react'
import { Image, useProductCards, useStorefront, type ContentBlock } from '@dripfunnel/storefront-core/theme'
import { ProductCard } from '../ProductCard'
import shop from '../../styles/shop.module.css'
import styles from '../../styles/content.module.css'

/** A question that opens to its answer, as D1's FAQ draws them. */
const Question = ({ question, answer }: { question: string; answer: string }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.question}>
      <button type="button" className={styles.ask} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{question}</span>
        <span className={styles.sign} aria-hidden="true" />
      </button>
      {open ? <p className={styles.answer}>{answer}</p> : null}
    </div>
  )
}

const Products = ({ slugs }: { slugs: string[] }) => {
  const { cards } = useProductCards(slugs)
  return cards.length > 0 ? (
    <div className={shop.grid}>
      {cards.map((c) => (
        <ProductCard key={c.id} product={c} />
      ))}
    </div>
  ) : null
}

/** The contact form block: the Shop API takes no message yet, so it gives the store's own email and phone to write to. */
const Contact = () => {
  const { store, t } = useStorefront()
  if (!store.contactEmail && !store.contactPhone) return null
  return (
    <section className={styles.contact} aria-label={t('pages.content.contact')}>
      <h2 className={styles.heading}>{t('pages.content.contact')}</h2>
      {store.contactEmail ? <p className={styles.text}>{t('pages.content.email', { email: store.contactEmail })}</p> : null}
      {store.contactPhone ? <p className={styles.text}>{t('pages.content.phone', { phone: store.contactPhone })}</p> : null}
    </section>
  )
}

/** A content page's or a post's blocks, the merchant's words as plain text. */
export const ContentBlocks = ({ blocks }: { blocks: ContentBlock[] }) => {
  const { t } = useStorefront()
  return (
    <div className={styles.prose}>
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <h2 key={i} className={styles.heading}>
            {b.text}
          </h2>
        ) : b.kind === 'text' ? (
          b.text.split(/\n{2,}/).map((para, j) => (
            <p key={`${i}-${j}`} className={styles.text}>
              {para}
            </p>
          ))
        ) : b.kind === 'image' ? (
          <Image key={i} image={b.photo} alt={b.photo.alt ?? ''} ratio={1.6} sizes="(min-width: 900px) 720px, 100vw" className={styles.image} />
        ) : b.kind === 'faq' ? (
          <section key={i} className={styles.faq} aria-label={t('pages.content.questions')}>
            {b.items.map((q, j) => (
              <Question key={j} question={q.question} answer={q.answer} />
            ))}
          </section>
        ) : b.kind === 'products' ? (
          <Products key={i} slugs={b.slugs} />
        ) : (
          <Contact key={i} />
        ),
      )}
    </div>
  )
}
