'use client'

import { useStorefront, type ProductPage } from '@dripfunnel/storefront-core/theme'

/** Each option's values as buttons; a value sold out with the other choices looks unavailable but can still be chosen. */
export const Options = ({ page }: { page: ProductPage }) => {
  const { t } = useStorefront()
  return (
    <div className="flex w-full flex-col gap-y-4 gap-x-4">
      {page.options.map((option) => (
        <div key={option.id} role="group" aria-label={option.name} className="flex flex-col gap-y-2 gap-x-2">
          <p className="m-0 text-muted text-[14px]">{option.name}</p>
          <div className="flex flex-wrap gap-y-2 gap-x-2">
            {option.values.map((value) => (
              <button
                key={value.id}
                type="button"
                aria-pressed={value.selected}
                aria-label={value.available ? value.name : t('shop.product.unavailable', { value: value.name })}
                className={value.selected ? 'py-0 px-4 border border-ink min-w-14 min-h-11 rounded-[8px] bg-surface text-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold cursor-pointer [box-shadow:inset_0_0_0_1px_var(--color-ink)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]' : value.available ? 'py-0 px-4 border border-line min-w-14 min-h-11 rounded-[8px] bg-surface text-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]' : 'py-0 px-4 border border-line min-w-14 min-h-11 rounded-[8px] bg-surface [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold cursor-pointer text-muted [text-decoration:line-through] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'}
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
