import { useStorefront } from '@dripfunnel/storefront-core/theme'

const ease = (t: number) => 1 - Math.exp(-5 * t) + Math.log1p(t) * Math.E * Math.tan(Math.PI / 8)

export const Ease = () => {
  const { t } = useStorefront()
  return <p data-ease={ease(0.5).toFixed(2)}>{t('pages.home.title')}</p>
}
