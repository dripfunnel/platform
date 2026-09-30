import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { goLiveChecks, type PartnerApproval, type PartnerRow } from '../../api/partners'
import { fill, formatCount, formatTime, formatWait, messages } from '../../messages'
import { StatusPill } from '../common/StatusPill'
import { Tile } from '../common/Tile'
import './approvals.css'

const words = messages.approvals
const checkWords = messages.partners.checks

const secondsSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))

// Who set the partner up, and so who still has to approve it (FIRST-RELEASE.md §4.3). The rule
// is the API's answer; the fixture enforces the part it can on Approve.
const Approvers = ({ approval, partner }: { approval: PartnerApproval; partner: string }) => (
  <div className="df-approval-who">
    <strong>{approval.setUpBy ? fill(words.setUpBy, { name: approval.setUpBy }) : fill(words.setUpByPartner, { partner })}</strong>
    <span>{fill(words.approvers[approval.rule], { name: approval.setUpBy ?? '' })}</span>
  </div>
)

// The prototype's Approvals card. Review opens the partner, where Approve and Send back are:
// one approve path, never a second one here (decided on #43).
export const ApprovalCard = ({ partner }: { partner: PartnerRow }) => {
  const titleId = useId()
  const passing = goLiveChecks.filter((check) => partner.checks[check]).length
  const allPass = passing === goLiveChecks.length
  return (
    <section className="df-approval" aria-labelledby={titleId}>
      <div className="df-approval-head">
        <Tile name={partner.name} large />
        <div className="df-approval-name">
          <Link id={titleId} to="/partners/$partnerId" params={{ partnerId: partner.id }} className="df-row-title">
            {partner.name}
          </Link>
          {partner.submittedAt && (
            <span className="df-muted">
              {fill(words.submitted, { date: formatTime(partner.submittedAt), wait: formatWait(secondsSince(partner.submittedAt)) })}
            </span>
          )}
        </div>
        <span className={allPass ? 'df-approval-sum df-approval-sum--pass' : 'df-approval-sum df-approval-sum--fail'}>
          {fill(words.checksPass, { count: formatCount(passing), total: formatCount(goLiveChecks.length) })}
        </span>
        <Link
          to="/partners/$partnerId"
          params={{ partnerId: partner.id }}
          className="df-button df-button--primary"
          aria-label={fill(words.reviewLabel, { name: partner.name })}
        >
          {words.review}
        </Link>
      </div>
      {partner.approval && <Approvers approval={partner.approval} partner={partner.name} />}
      <ul className="df-approval-checks" aria-label={fill(words.checksLabel, { name: partner.name })}>
        {goLiveChecks.map((check) => (
          <li key={check}>
            <span>{checkWords[check]}</span>
            {partner.checks[check] ? (
              <StatusPill tone="success" icon="ok" label={words.check.pass} />
            ) : (
              <StatusPill tone="danger" icon="cross" label={words.check.fail} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
