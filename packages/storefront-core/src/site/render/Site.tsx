import type { CSSProperties, FormEvent, ReactNode } from 'react'
import type { Site, SiteSection } from '../schema'
import { hrefForLabel, type SiteLinks } from './links'
import { siteCss, themeVars } from './styles'

/** A product as the site shows it: the catalogue's own name, photo and price (never set by site data). */
export type SiteProduct = {
  id: string
  name: string
  href: string
  /** The price with its tax label, rendered by core's price component. */
  price: ReactNode
  image: { url: string; alt: string } | null
}

export type SitePageName = 'home' | 'about' | 'contact' | 'other'

type Common = { site: Site; store: string; links: SiteLinks }

const Img = ({ image }: { image: SiteProduct['image'] }) => (image ? <img className="dfs-img" src={image.url} alt={image.alt} loading="lazy" decoding="async" /> : null)

const Announcement = ({ site }: { site: Site }) =>
  site.announce.on && site.announce.text ? (
    <p className="dfs-ann" style={{ background: site.announce.bg, color: site.announce.fg }}>
      {site.announce.text}
    </p>
  ) : null

const Nav = ({ site, links, current, className }: Common & { current: SitePageName; className?: string }) => (
  <ul className={className ?? 'dfs-nav'}>
    {site.header.menu.map((label) => {
      const href = hrefForLabel(label, links)
      const page = href === links.about ? 'about' : href === links.contact ? 'contact' : undefined
      return (
        <li key={label}>
          <a href={href} aria-current={page && page === current ? 'page' : undefined}>
            {label}
          </a>
        </li>
      )
    })}
  </ul>
)

const Header = (p: Common & { current: SitePageName; cartCount: number; labels: SiteLabels }) => {
  const { site, store, links, cartCount, labels } = p
  const cart = (
    <a className="dfs-cart" href={links.cart}>
      {labels.cart(cartCount)}
    </a>
  )
  const phoneMenu = (
    <details className="dfs-menu">
      <summary>{labels.menu}</summary>
      <Nav {...p} className="" />
    </details>
  )
  const row = (extra?: string) => (
    <div className={`dfs-hdr-row${extra ? ` ${extra}` : ''}`}>
      <a className="dfs-brand" href={links.home}>
        {store}
      </a>
      <nav className="dfs-wide-only" aria-label={labels.mainMenu}>
        <Nav {...p} />
      </nav>
      <span className="dfs-spacer" />
      <a className="dfs-cart dfs-wide-only" href={links.search('')}>
        {labels.search}
      </a>
      {phoneMenu}
      {cart}
    </div>
  )
  return (
    <header className="dfs-hdr" style={{ background: site.header.bg, color: site.header.fg }}>
      {site.header.style === 'center' ? (
        <>
          <div className="dfs-hdr-center">
            <a className="dfs-brand" href={links.home}>
              {store}
            </a>
            <nav aria-label={labels.mainMenu} style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
              <Nav {...p} />
              {cart}
            </nav>
          </div>
          {row('when-center')}
        </>
      ) : (
        row()
      )}
    </header>
  )
}

const Footer = ({ site, store, links, poweredBy, year }: Common & { poweredBy: string | null; year: number }) => {
  const t = site.theme
  const [bg, fg] = { light: [t.surface, t.text], dark: [t.text, t.bg], accent: [t.accent, t.accentText] }[site.footer.tone]
  return (
    <footer className="dfs-ftr" style={{ background: bg, color: fg }}>
      <div className="dfs-ftr-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 320 }}>
          <span className="dfs-ftr-brand">{store}</span>
          {site.footer.text ? <p className="dfs-ftr-text">{site.footer.text}</p> : null}
        </div>
        {site.footer.links.length ? (
          <ul>
            {site.footer.links.map((label) => (
              <li key={label}>
                <a href={hrefForLabel(label, links)}>{label}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="dfs-copy">
        © {year} {store}
        {poweredBy ? ` · Powered by ${poweredBy}` : ''}
      </p>
    </footer>
  )
}

/** The words the site renders that aren't the merchant's: from core's messages, per locale. */
export type SiteLabels = {
  cart: (count: number) => string
  menu: string
  mainMenu: string
  search: string
  viewAll: string
  emailAddress: string
  emailLabel: string
  contactEmail: string
  contactPhone: string
  contactVisit: string
}

export const englishLabels: SiteLabels = {
  cart: (n) => `Cart (${n})`,
  menu: 'Menu',
  mainMenu: 'Main menu',
  search: 'Search',
  viewAll: 'View all',
  emailAddress: 'Email address',
  emailLabel: 'Your email address',
  contactEmail: 'Email',
  contactPhone: 'Phone',
  contactVisit: 'Visit',
}

type SectionProps = Common & { products: readonly SiteProduct[]; labels: SiteLabels; index: number; first: boolean; onSubscribe?: ((email: string) => void) | undefined }

const productAt = (products: readonly SiteProduct[], i: number) => (products.length ? products[i % products.length] : undefined)

const Heading = ({ first, children }: { first: boolean; children: ReactNode }) =>
  first ? <h1 className="dfs-h dfs-h1">{children}</h1> : <h2 className="dfs-h dfs-h1">{children}</h2>

const Section = ({ section: s, ...p }: SectionProps & { section: SiteSection }): ReactNode => {
  const t = p.site.theme
  switch (s.type) {
    case 'hero': {
      const photo = productAt(p.products, p.index)?.image ?? null
      const button = s.cta ? (
        <a className="dfs-btn" href={p.links.shop}>
          {s.cta}
        </a>
      ) : null
      if (s.layout === 'full')
        return (
          <section className="dfs-sec dfs-full">
            <Img image={photo} />
            <div className="dfs-stack">
              <Heading first={p.first}>{s.headline}</Heading>
              {s.sub ? <p style={{ margin: 0, fontSize: 'var(--lead)' }}>{s.sub}</p> : null}
              {button}
            </div>
          </section>
        )
      if (s.layout === 'centered')
        return (
          <section className="dfs-sec dfs-center">
            <Heading first={p.first}>{s.headline}</Heading>
            {s.sub ? <p className="dfs-lead" style={{ maxWidth: '48ch' }}>{s.sub}</p> : null}
            {button}
            <div className="dfs-wide dfs-ph">
              <Img image={photo} />
            </div>
          </section>
        )
      return (
        <section className="dfs-sec dfs-split">
          <div className="dfs-stack">
            <Heading first={p.first}>{s.headline}</Heading>
            {s.sub ? <p className="dfs-lead" style={{ maxWidth: '44ch' }}>{s.sub}</p> : null}
            {button}
          </div>
          <div className="dfs-hero-img dfs-ph">
            <Img image={photo} />
          </div>
        </section>
      )
    }
    case 'products': {
      const items = p.products.slice(0, s.count)
      if (!items.length) return null
      return (
        <section className="dfs-sec" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="dfs-row">
            <h2 className="dfs-h dfs-h2">{s.title}</h2>
            <a href={p.links.shop} style={{ fontSize: 14, textUnderlineOffset: 3, whiteSpace: 'nowrap' }}>
              {p.labels.viewAll}
            </a>
          </div>
          <ul className="dfs-grid" style={{ '--cols': s.cols } as CSSProperties}>
            {items.map((item) => (
              <li key={item.id}>
                <a className={`dfs-card${s.card === 'boxed' ? ' boxed' : ''}`} href={item.href}>
                  <div className="dfs-card-img" style={{ aspectRatio: s.aspect === 'portrait' ? '3/4' : '1/1' }}>
                    <Img image={item.image} />
                  </div>
                  <span className="dfs-card-name">{item.name}</span>
                  <span className="dfs-card-price">{item.price}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )
    }
    case 'categories':
      return (
        <section className="dfs-sec" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {s.title ? <h2 className="dfs-h dfs-h2">{s.title}</h2> : null}
          <ul className="dfs-grid" style={{ '--cols': s.items.length } as CSSProperties}>
            {s.items.map((label, k) => (
              <li key={label}>
                <a className="dfs-tile" href={p.links.search(label)}>
                  <Img image={productAt(p.products, k + 2)?.image ?? null} />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )
    case 'banner': {
      const [bg, fg, btnBg, btnFg] = { accent: [t.accent, t.accentText, t.accentText, t.accent], dark: [t.text, t.bg, t.bg, t.text], light: [t.surface, t.text, t.accent, t.accentText] }[s.tone]
      return (
        <section className="dfs-sec dfs-banner" style={{ background: bg, color: fg }}>
          <h2 className="dfs-h dfs-h2">{s.headline}</h2>
          {s.sub ? <p>{s.sub}</p> : null}
          {s.cta ? (
            <a className="dfs-btn" href={p.links.shop} style={{ background: btnBg, color: btnFg }}>
              {s.cta}
            </a>
          ) : null}
        </section>
      )
    }
    case 'features':
      if (!s.items.length) return null
      return (
        <section className="dfs-feat">
          {s.title ? <h2 className="dfs-h dfs-h2">{s.title}</h2> : null}
          <ul className="dfs-grid" style={{ '--cols': s.items.length, gap: 'var(--gap)' } as CSSProperties}>
            {s.items.map((f) => (
              <li key={f.title} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="dfs-feat-title">{f.title}</span>
                <span style={{ color: 'var(--dfs-muted)', fontSize: 14 }}>{f.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )
    case 'testimonial':
      if (!s.quote) return null
      return (
        <figure className="dfs-sec dfs-quote">
          <blockquote>“{s.quote}”</blockquote>
          {s.author ? <figcaption>{s.author}</figcaption> : null}
        </figure>
      )
    case 'newsletter': {
      const { onSubscribe } = p
      const submit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const email = new FormData(e.currentTarget).get('email')
        if (typeof email === 'string' && onSubscribe) onSubscribe(email)
      }
      return (
        <section className="dfs-sec dfs-banner">
          <h2 className="dfs-h dfs-h2">{s.headline}</h2>
          {s.sub ? <p className="dfs-lead">{s.sub}</p> : null}
          {onSubscribe ? (
            <form className="dfs-form" onSubmit={submit}>
              <input className="dfs-input" type="email" name="email" required autoComplete="email" placeholder={p.labels.emailAddress} aria-label={p.labels.emailLabel} />
              <button className="dfs-btn" type="submit">
                {s.cta}
              </button>
            </form>
          ) : null}
        </section>
      )
    }
    case 'text':
      return (
        <section className={`dfs-sec dfs-text${s.align === 'center' ? ' center' : ''}`}>
          {s.headline ? <h2 className="dfs-h dfs-h2">{s.headline}</h2> : null}
          {s.body ? <p className="dfs-lead">{s.body}</p> : null}
        </section>
      )
  }
}

export type SiteLayoutProps = Common & {
  current: SitePageName
  cartCount?: number
  /** The brand's "Powered by" name when its rule shows it (a required component), else null. */
  poweredBy: string | null
  labels?: SiteLabels
  year?: number
  children: ReactNode
}

/** The site's frame: theme, announcement bar, header, the page, footer. */
export const SiteLayout = ({ site, store, links, current, cartCount = 0, poweredBy, labels = englishLabels, year = new Date().getUTCFullYear(), children }: SiteLayoutProps) => (
  <div className="dfs" style={themeVars(site.theme) as CSSProperties}>
    <style>{siteCss}</style>
    <div className="dfs-in">
      <Announcement site={site} />
      <Header site={site} store={store} links={links} current={current} cartCount={cartCount} labels={labels} />
      <main>{children}</main>
      <Footer site={site} store={store} links={links} poweredBy={poweredBy} year={year} />
    </div>
  </div>
)

export type SiteHomeProps = Common & { products: readonly SiteProduct[]; labels?: SiteLabels; onSubscribe?: (email: string) => void }

/** The home page's sections, in order. The first hero carries the page's h1; without one, the store's name does. */
export const SiteHome = ({ site, store, links, products, labels = englishLabels, onSubscribe }: SiteHomeProps) => {
  const firstHero = site.sections.findIndex((s) => s.type === 'hero')
  return (
    <>
      {firstHero === -1 ? <h1 className="dfs-sr">{store}</h1> : null}
      {site.sections.map((s, i) => (
        <Section key={s.id} section={s} site={site} store={store} links={links} products={products} labels={labels} index={i} first={i === firstHero} onSubscribe={onSubscribe} />
      ))}
    </>
  )
}

export const SiteAbout = ({ site, image }: { site: Site; image: SiteProduct['image'] }) => (
  <section className="dfs-sec dfs-split" style={{ alignItems: 'start' }}>
    <div className="dfs-stack">
      <h1 className="dfs-h dfs-h1">{site.pages.about.headline}</h1>
      {site.pages.about.body
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((para, i) => (
          <p key={i} className="dfs-lead" style={{ maxWidth: '56ch' }}>
            {para}
          </p>
        ))}
    </div>
    <div className="dfs-about-img dfs-ph">
      <Img image={image} />
    </div>
  </section>
)

/** Contact: the page's words and the store's details. No form: messages need a Shop API operation not built yet (#304). */
export const SiteContact = ({ site, labels = englishLabels }: { site: Site; labels?: SiteLabels }) => {
  const c = site.pages.contact
  const rows: [string, ReactNode][] = []
  if (c.email) rows.push([labels.contactEmail, <a href={`mailto:${c.email}`}>{c.email}</a>])
  if (c.phone) rows.push([labels.contactPhone, <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a>])
  if (c.address) rows.push([labels.contactVisit, c.address])
  return (
    <section className="dfs-sec dfs-contact" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 className="dfs-h dfs-h1">{c.headline}</h1>
        {c.body ? <p className="dfs-lead" style={{ maxWidth: '52ch' }}>{c.body}</p> : null}
      </div>
      {rows.length ? (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
