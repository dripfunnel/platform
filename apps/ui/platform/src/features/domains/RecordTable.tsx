import type { DnsRecord, DomainKind } from '../../api/domains'
import { fill, messages } from '../../messages'
import { purposeText } from './domainLook'

const words = messages.domains.records

export interface RecordTableProps {
  host: string
  kind: DomainKind
  records: readonly DnsRecord[]
  // What DNS returned, beside each record: the cards show it; Add an address doesn't have it yet.
  showFound: boolean
  onCopy: (text: string) => void
}

// Type, Name, Value to add with Copy and its plain words, and What we see (§9.1, §9.2).
export const RecordTable = ({ host, kind, records, showFound, onCopy }: RecordTableProps) => (
  <table className="df-dns" aria-label={fill(words.label, { host })}>
    <thead>
      <tr>
        <th scope="col">{words.type}</th>
        <th scope="col">{words.name}</th>
        <th scope="col">{showFound ? words.value : words.valueShort}</th>
        {showFound && <th scope="col">{words.found}</th>}
      </tr>
    </thead>
    <tbody>
      {records.map((record) => (
        <tr key={`${record.type} ${record.name}`}>
          <td data-label={words.type}>
            <strong>{record.type}</strong>
          </td>
          <td data-label={words.name}>
            <span className="df-dns-copy">
              <code>{record.name}</code>
              {!showFound && (
                <button type="button" className="df-button df-button--small" aria-label={fill(words.copyName, { type: record.type, name: record.name })} onClick={() => onCopy(record.name)}>
                  {words.copy}
                </button>
              )}
            </span>
          </td>
          <td data-label={showFound ? words.value : words.valueShort}>
            <span className="df-dns-copy">
              <code>{record.value}</code>
              <button type="button" className="df-button df-button--small" aria-label={fill(words.copyValue, { type: record.type, name: record.name })} onClick={() => onCopy(record.value)}>
                {words.copy}
              </button>
            </span>
            <span className="df-muted df-dns-plain">{purposeText(record, kind)}</span>
          </td>
          {showFound && (
            <td data-label={words.found}>
              {record.found === null ? (
                <span className="df-muted">{words.nothing}</span>
              ) : (
                <span className="df-dns-found">
                  <code>{record.found}</code>
                  {!record.matches && <span className="df-dns-mismatch">{words.mismatch}</span>}
                </span>
              )}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  </table>
)
