'use client'

import { useId, useState, type ReactNode } from 'react'
import { Link } from '../../platform/browser/link'
import { Image } from '../../platform/media/media'
import type { Photo } from '../../platform/media/photo'
import { useStorefront } from '../../platform/store/context'
import type { Product } from '../../products/product'
import type { StoryItem, StoryModule } from '../../products/story'
import { Price } from '../../sealed/components'

// A product's A+ content (storefront ARCHITECTURE §2.1 `ui/headless`; #1351): core draws every module kind from what the
// Shop API sends, with no network call and no script of its own, and the theme places it and styles it through class names.

/** The class each piece takes; every module also carries `data-kind` (its kind) and an image-and-text one `data-side` for a theme's CSS to use. */
export type ProductStoryClasses = Partial<
  Record<'root' | 'module' | 'heading' | 'text' | 'picture' | 'grid' | 'item' | 'itemTitle' | 'list' | 'table' | 'question' | 'answer' | 'video' | 'link', string>
>

export type ProductStoryProps = {
  /** `useProduct().product`; draws nothing while it is null or has no published A+ content. */
  product: Product | null
  /** The chosen version, so the specifications module shows that version's own as well as the product's. */
  versionId?: string | null
  className?: string
  classes?: ProductStoryClasses
}

const pictureRatio = 1.6
const withClass = (name: string | undefined) => (name ? { className: name } : {})

const Picture = ({ photo, ratio = pictureRatio, sizes, className }: { photo: Photo; ratio?: number; sizes?: string; className: string | undefined }) => (
  <Image image={photo} alt={photo.alt ?? ''} ratio={ratio} {...withClass(className)} {...(sizes ? { sizes } : {})} />
)

const Question = ({ question, answer, classes }: { question: string; answer: string; classes: ProductStoryClasses }) => {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={classes.item}>
      <h3 className={classes.itemTitle}>
        <button type="button" className={classes.question} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {question}
        </button>
      </h3>
      <div id={id} className={classes.answer} hidden={!open}>
        {answer}
      </div>
    </div>
  )
}

const Items = ({ items, classes }: { items: StoryItem[]; classes: ProductStoryClasses }) => (
  <ul className={classes.list}>
    {items.map((item, i) => (
      <li key={`${item.title}-${i}`} className={classes.item}>
        {item.photo ? <Picture photo={item.photo} ratio={1.5} sizes="(min-width: 900px) 33vw, 100vw" className={classes.picture} /> : null}
        <h3 className={classes.itemTitle}>{item.title}</h3>
        {item.text ? <p className={classes.text}>{item.text}</p> : null}
      </li>
    ))}
  </ul>
)

const Module = ({ module, product, versionId, classes }: { module: StoryModule; product: Product; versionId: string | null; classes: ProductStoryClasses }) => {
  const { t, store, locale } = useStorefront()
  const titled = (fallback: Parameters<typeof t>[0] | null, body: ReactNode) => {
    const heading = module.title ?? (fallback ? t(fallback) : null)
    return (
      <>
        {heading ? <h2 className={classes.heading}>{heading}</h2> : null}
        {body}
      </>
    )
  }
  const wrap = (body: ReactNode, side?: string) => (
    <div className={classes.module} data-kind={module.kind} {...(side ? { 'data-side': side } : {})}>
      {body}
    </div>
  )
  switch (module.kind) {
    case 'banner':
      return wrap(
        <>
          <Picture photo={module.photo} ratio={2.4} className={classes.picture} />
          {module.title ? <h2 className={classes.heading}>{module.title}</h2> : null}
        </>,
      )
    case 'imageText':
      return wrap(
        <>
          <Picture photo={module.photo} sizes="(min-width: 900px) 50vw, 100vw" className={classes.picture} />
          <div className={classes.text}>{titled(null, module.body ? <p>{module.body}</p> : null)}</div>
        </>,
        module.side,
      )
    case 'brand':
      return wrap(
        <>
          {module.photo ? <Picture photo={module.photo} sizes="(min-width: 900px) 50vw, 100vw" className={classes.picture} /> : null}
          <div className={classes.text}>{titled('story.brand', module.body ? <p>{module.body}</p> : null)}</div>
        </>,
        'left',
      )
    case 'features':
      return wrap(titled('story.features', <Items items={module.items} classes={classes} />))
    case 'box':
      return wrap(
        titled(
          'story.box',
          <ul className={classes.list}>
            {module.items.map((item, i) => (
              <li key={`${item.title}-${i}`} className={classes.item}>
                {item.title}
              </li>
            ))}
          </ul>,
        ),
      )
    case 'gallery':
      return wrap(
        titled(
          'story.gallery',
          <ul className={classes.grid}>
            {module.photos.map((photo, i) => (
              <li key={`${photo.url}-${i}`} className={classes.item}>
                <Picture photo={photo} ratio={1} sizes="(min-width: 900px) 25vw, 50vw" className={classes.picture} />
              </li>
            ))}
          </ul>,
        ),
      )
    case 'compare':
      return wrap(
        titled(
          'story.compare',
          <ul className={classes.grid}>
            {module.products.map((p) => (
              <li key={p.id} className={classes.item}>
                {p.photo ? <Picture photo={p.photo} ratio={1} sizes="(min-width: 900px) 20vw, 50vw" className={classes.picture} /> : null}
                <Link href={p.href} {...withClass(classes.link)}>
                  {p.name}
                </Link>
                {p.price ? <Price money={p.price} compareAt={p.compareAt} includesTax={store.pricesIncludeTax} locale={locale} t={t} /> : null}
              </li>
            ))}
          </ul>,
        ),
      )
    case 'specs': {
      const specs = product.specs.filter((s) => s.versionId === null || s.versionId === versionId)
      if (specs.length === 0) return null
      return wrap(
        titled(
          'story.specs',
          <dl className={classes.table}>
            {specs.map((s) => (
              <div key={`${s.name}-${s.versionId ?? ''}`} className={classes.item}>
                <dt>{s.name}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>,
        ),
      )
    }
    case 'faq':
      if (product.faqs.length === 0) return null
      return wrap(titled('story.faq', product.faqs.map((f) => <Question key={f.question} question={f.question} answer={f.answer} classes={classes} />)))
    case 'video':
      return wrap(
        titled(
          'story.video',
          module.file ? (
            <video className={classes.video} src={module.file.url} controls preload="none" playsInline aria-label={module.title ?? t('story.video')} />
          ) : module.link ? (
            <Link href={module.link} {...withClass(classes.link)}>
              {t('story.watch')}
            </Link>
          ) : null,
        ),
      )
  }
}

/** The "More about this product" section: the published modules in the merchant's order, or nothing when there are none. */
export const ProductStory = ({ product, versionId = null, className, classes = {} }: ProductStoryProps) => {
  const { t } = useStorefront()
  if (!product || product.story.length === 0) return null
  return (
    <section aria-label={t('story.label')} className={className ?? classes.root}>
      {product.story.map((module) => (
        <Module key={module.id} module={module} product={product} versionId={versionId} classes={classes} />
      ))}
    </section>
  )
}
