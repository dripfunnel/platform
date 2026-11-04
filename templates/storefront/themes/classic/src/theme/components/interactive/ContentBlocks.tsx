'use client'

import { useState } from 'react'
import { Image, useProductCards, useStorefront, type ContentBlock } from '@dripfunnel/storefront-core/theme'
import { ProductCard } from '../ProductCard'

/** A question that opens to its answer, as D1's FAQ draws them. */
const Question = ({ question, answer }: { question: string; answer: string }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-b-line">
      <button type="button" className="group/content-ask py-3 px-0 border-0 border-current flex w-full min-h-14 items-center justify-between gap-y-4 gap-x-4 bg-transparent text-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold text-start cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{question}</span>
        <span className={'border-r-[2px] border-b-[2px] border-r-current border-b-current w-2.5 h-2.5 shrink-0 [transform:rotate(45deg)] [transition:transform_0.2s] group-[[aria-expanded="true"]]/content-ask:[transform:rotate(225deg)]'} aria-hidden="true" />
      </button>
      {open ? <p className="mt-0 mr-0 mb-4 ml-0 text-ink-soft leading-[1.6] whitespace-pre-line">{answer}</p> : null}
    </div>
  )
}

const Products = ({ slugs }: { slugs: string[] }) => {
  const { cards } = useProductCards(slugs)
  return cards.length > 0 ? (
    <div className="p-0 m-0 grid gap-y-6 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:group-[:nth-child(n)]/shop-listing:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-y-8 min-[900px]:gap-x-4.5 min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]">
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
    <section className="p-4.5 border border-line flex flex-col gap-y-2 gap-x-2 rounded-card bg-surface" aria-label={t('pages.content.contact')}>
      <h2 className="mt-2 mr-0 mb-0 ml-0 font-heading text-[24px] font-[var(--heading-weight)]">{t('pages.content.contact')}</h2>
      {store.contactEmail ? <p className="m-0 text-ink text-[17px] leading-[1.65] wrap-anywhere whitespace-pre-line">{t('pages.content.email', { email: store.contactEmail })}</p> : null}
      {store.contactPhone ? <p className="m-0 text-ink text-[17px] leading-[1.65] wrap-anywhere whitespace-pre-line">{t('pages.content.phone', { phone: store.contactPhone })}</p> : null}
    </section>
  )
}

/** A content page's or a post's blocks, the merchant's words as plain text. */
export const ContentBlocks = ({ blocks }: { blocks: ContentBlock[] }) => {
  const { t } = useStorefront()
  return (
    <div className="flex flex-col gap-y-4 gap-x-4">
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <h2 key={i} className="mt-2 mr-0 mb-0 ml-0 font-heading text-[24px] font-[var(--heading-weight)]">
            {b.text}
          </h2>
        ) : b.kind === 'text' ? (
          b.text.split(/\n{2,}/).map((para, j) => (
            <p key={`${i}-${j}`} className="m-0 text-ink text-[17px] leading-[1.65] wrap-anywhere whitespace-pre-line">
              {para}
            </p>
          ))
        ) : b.kind === 'image' ? (
          <Image key={i} image={b.photo} alt={b.photo.alt ?? ''} ratio={1.6} sizes="(min-width: 900px) 720px, 100vw" className="w-full h-auto rounded-card" />
        ) : b.kind === 'faq' ? (
          <section key={i} className="border-t border-t-line grid" aria-label={t('pages.content.questions')}>
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
