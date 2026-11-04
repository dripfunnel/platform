'use client'

import { useStorefront, type ProductPage } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/product.module.css'

/** Each option's values as buttons; a value sold out with the other choices looks unavailable but can still be chosen. */
export const Options = ({ page }: { page: ProductPage }) => {
  const { t } = useStorefront()
  return (
    <div className={styles.options}>
      {page.options.map((option) => (
        <div key={option.id} role="group" aria-label={option.name} className={styles.option}>
          <p className={styles.optionName}>{option.name}</p>
          <div className={styles.values}>
            {option.values.map((value) => (
              <button
                key={value.id}
                type="button"
                aria-pressed={value.selected}
                aria-label={value.available ? value.name : t('shop.product.unavailable', { value: value.name })}
                className={value.selected ? styles.valueOn : value.available ? styles.value : styles.valueGone}
                onClick={() => page.choose(option.id, value.id)}
              >
                {value.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
