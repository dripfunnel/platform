import { BrandMark as SharedBrandMark } from '@dripfunnel/mobile-shared/brand'
import { t } from '../messages'

const labels = { logo: (name: string) => t('brand.logo', { name }), logoUnnamed: t('brand.logoUnnamed') }

export const BrandMark = () => <SharedBrandMark labels={labels} />
