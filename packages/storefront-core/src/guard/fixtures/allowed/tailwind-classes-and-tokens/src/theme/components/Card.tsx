import { clsx } from 'clsx'
import { useStorefront } from '@dripfunnel/storefront-core/theme'

export const Card = ({ tone, open }: { tone: 'quiet' | 'loud'; open: boolean }) => {
  const { t } = useStorefront()

  return (
    <article className={clsx('group relative z-50 flex flex-col gap-4 rounded-card p-4 md:grid md:grid-cols-3 min-[720px]:p-6', tone === 'quiet' ? 'bg-paper text-ink' : 'bg-ink text-paper', { 'opacity-90': !open })}>
      <h2 className="font-display text-[21px] tracking-[-0.01em] transition-colors hover:text-ink/80 group-hover:underline">{t('pages.home.title')}</h2>
      <div className="space-y-2 [&_p]:m-0 [&::part(price)]:text-ink before:block before:content-[''] aria-expanded:rotate-180 data-[open]:flex">
        <p className="motion-safe:animate-rise [transition:opacity_.3s,transform_.3s] focus-visible:outline-2">{t('pages.home.lead')}</p>
      </div>
      <button type="button" className="peer size-11 shrink-0 bg-(--color-ink) shadow-[0_1px_2px_rgb(0_0_0/0.1)] transition-transform">{t('pages.home.title')}</button>
      <span className="hidden peer-hover:inline">{t('pages.home.lead')}</span>
    </article>
  )
}
