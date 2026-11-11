'use client'

import { useStorefront, type ProductPage } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/product.module.css'

/** Each option's values as buttons; a value out of stock with the other choices made stays announced and focusable but can't be chosen. */
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
                aria-disabled={value.available ? undefined : true}
                aria-label={value.available ? value.name : t('shop.product.unavailable', { value: value.name })}
                className={`${value.selected ? styles.valueOn : styles.value} ${value.available ? '' : styles.valueGone}`}
                onClick={() => {
                  if (value.available) page.choose(option.id, value.id)
                }}
              >
                <span className={styles.valueName}>{value.name}</span>
                {!value.available && (
                  <span className={styles.valueNote} aria-hidden="true">
                    {t('shop.product.outOfStockShort')}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
