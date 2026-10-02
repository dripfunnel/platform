import { useState, type ReactNode } from 'react'
import type { ActivityPage } from '../../api/activity'
import { messages } from '../../messages'
import { ActivityRow } from './ActivityRow'
import { Pager } from '@dripfunnel/shared/ui'
import './activity.css'

const words = messages.activity

export interface ActivityListProps {
  page: ActivityPage
  pageLink: (cursor: { before: string } | { after: string }, label: string) => ReactNode
}

// Pages of 50 with Previous and Next and no total (decided on #44), so the list never grows without bound.
export const ActivityList = ({ page, pageLink }: ActivityListProps) => {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <>
      <ul className="df-activity-list" aria-label={words.listLabel}>
        {page.items.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} open={open.has(entry.id)} onToggle={() => toggle(entry.id)} />
        ))}
      </ul>
      <div className="df-activity-foot">
        <p className="df-muted">{words.readOnlyNote}</p>
        <Pager words={messages.common.pager} label={words.pagerLabel} pageInfo={page.pageInfo} link={pageLink} />
      </div>
    </>
  )
}
