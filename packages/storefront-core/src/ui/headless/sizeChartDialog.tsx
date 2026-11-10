'use client'

import { useId, type MouseEvent } from 'react'
import { useStorefront } from '../../platform/store/context'
import type { SizeChart as Chart } from '../../products/product'

// The size chart's modal, in its own chunk (sizeChart.tsx): only a shopper who opens a chart downloads it.

// A theme may style no ::backdrop or <dialog> (guard), so core styles the modal once per page with an adopted sheet, as sealed/element.ts does,
// from the shared sealed tokens a theme already sets (ARCHITECTURE §3.5).
const d = 'dialog[data-df-size-chart]'
const css = `${d}{box-sizing:border-box;width:calc(100% - 32px);max-width:560px;max-height:calc(100% - 48px);margin:auto;padding:22px;border:0;border-radius:calc(var(--df-sealed-radius,8px) * 2);background:var(--df-sealed-surface,#fff);color:var(--df-sealed-color,#1d1b18);font-family:var(--df-sealed-font,inherit)}
${d}[open]{display:flex;flex-direction:column;gap:14px}
${d}::backdrop{background:rgb(0 0 0 / 45%)}
${d} [data-head]{display:flex;align-items:center;justify-content:space-between;gap:12px}
${d} h2{margin:0;font-size:22px;line-height:1.15}
${d} button{min-height:44px;padding:0 16px;border:1px solid currentColor;border-radius:var(--df-sealed-radius,8px);background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
${d} button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
${d} [data-scroll]{min-height:0;overflow:auto}
${d} [data-scroll]:focus-visible{outline:2px solid currentColor;outline-offset:2px}
${d} table{width:100%;border-collapse:collapse;font-size:14px}
${d} caption{padding:0 8px 8px;text-align:left;color:var(--df-sealed-muted,currentColor)}
${d} th,${d} td{padding:10px 8px;border-bottom:1px solid var(--df-sealed-muted,currentColor);text-align:left}
${d} thead th{font-weight:600}
${d} p{margin:0;color:var(--df-sealed-muted,currentColor);font-size:13px}
@media (min-width:720px){${d}{padding:28px}}`
let sheet: CSSStyleSheet | null = null
const style = () => {
  if (sheet || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return
  sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
}

const unitKeys = { cm: 'sizeChart.unit.cm', in: 'sizeChart.unit.in' } as const

export type SizeChartDialogProps = { chart: Chart; onClose: () => void }

export const SizeChartDialog = ({ chart, onClose }: SizeChartDialogProps) => {
  const { t } = useStorefront()
  const titleId = useId()
  const unit = chart.unit === 'cm' || chart.unit === 'in' ? t(unitKeys[chart.unit]) : null

  // A click on the backdrop lands on the dialog itself; one on its own padding is inside it.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (e.target === e.currentTarget && (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom)) e.currentTarget.close()
  }
  const openDialog = (el: HTMLDialogElement | null) => {
    if (!el || el.open || typeof el.showModal !== 'function') return
    style()
    el.showModal()
  }

  return (
    <dialog ref={openDialog} data-df-size-chart="" aria-labelledby={titleId} onClose={onClose} onClick={onBackdrop}>
      <div data-head="">
        <h2 id={titleId}>
          {t('sizeChart.title')}
        </h2>
        <button type="button" onClick={(e) => e.currentTarget.closest('dialog')?.close()}>
          {t('sizeChart.close')}
        </button>
      </div>
      <div data-scroll="" role="region" aria-labelledby={titleId} tabIndex={0}>
        <table>
          {chart.name ? <caption>{chart.name}</caption> : null}
          <thead>
            <tr>
              <th scope="col">{t('sizeChart.size')}</th>
              {chart.measurements.map((m, i) => (
                <th key={`${i}:${m}`} scope="col">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((r) => (
              <tr key={r.size}>
                <th scope="row">{r.size}</th>
                {r.values.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unit ? <p>{unit}</p> : null}
    </dialog>
  )
}
