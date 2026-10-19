import { useState } from 'react'
import { customColumns, type CustomReport, type CustomRows, type ReportDays } from '../../api/reports'
import { t, type MessageKey } from '../../messages'
import { ChoiceRows } from '../settings/ChoiceRows'
import { FormSheet } from '../settings/FormSheet'

type Props = { rows: CustomRows; days: ReportDays; currency: string; onClose: () => void; onMake: (custom: CustomReport) => Promise<void> }

// The builder's second step (the prototype's "Custom report · 2 of 2"): which columns. A refusal, such as the plan, stays in the sheet.
export function CustomColumnsSheet({ rows, days, currency, onClose, onMake }: Props) {
  const [columns, setColumns] = useState<string>('basic')
  return (
    <FormSheet
      title={t('reports.custom.columnsTitle')}
      body={t('reports.custom.columnsBody', { days, currency })}
      confirm={t('reports.custom.make')}
      context="reports"
      onClose={onClose}
      onSubmit={async () => {
        await onMake({ rows, columns })
        return t('reports.custom.started')
      }}
    >
      <ChoiceRows label={t('reports.custom.columnsTag')} value={columns} options={customColumns[rows].map((column) => ({ value: column, label: t(`reports.custom.columns.${rows}.${column}` as MessageKey) }))} onChange={setColumns} />
    </FormSheet>
  )
}
