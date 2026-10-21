import type { Company, Contact } from '../../api/settings'
import { fill, formatAmount, formatCountry, messages } from '../../messages'

const words = messages.settings.company

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="df-settings-fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
)

// The contract's "Powered by" clause, by its code (DATA-MODEL §2: 'contract' or 'firstYear').
const poweredByText = (contract: NonNullable<Company['contract']>): string =>
  !contract.poweredByRemovable ? words.poweredByKept : contract.poweredByNote === 'firstYear' ? words.poweredByFirstYear : words.poweredByRemovable

const contactText = (contact: Contact | null) => (contact ? fill(words.contact, { name: contact.name, email: contact.email }) : words.none)

// Company (§14.1): read-only, the contract with the partner manager's line.
export const CompanyTab = ({ company }: { company: Company }) => (
  <div className="df-panels">
    <section className="df-panel" aria-labelledby="settings-company">
      <h2 id="settings-company">{words.title}</h2>
      <dl className="df-settings-facts">
        <Fact label={words.name}>{company.name}</Fact>
        {company.country && <Fact label={words.country}>{formatCountry(company.country)}</Fact>}
        {company.region && <Fact label={words.region}>{company.region}</Fact>}
        {company.kind && <Fact label={words.kind}>{company.kind}</Fact>}
        <Fact label={words.mainContact}>{contactText(company.mainContact)}</Fact>
        <Fact label={words.billingContact}>{contactText(company.billingContact)}</Fact>
      </dl>
      <p className="df-muted">{words.detailsLater}</p>
    </section>
    <section className="df-panel" aria-labelledby="settings-contract">
      <div className="df-stack">
        <h2 id="settings-contract">{words.contract}</h2>
        <span className="df-muted">{words.contractNote}</span>
      </div>
      {company.contract ? (
        <dl className="df-settings-facts">
          <Fact label={words.feeCurrency}>{company.contract.feeCurrency}</Fact>
          <Fact label={words.fees}>
            <ul className="df-settings-fees">
              {company.contract.fees.map((line) => (
                <li key={line.plan}>
                  <strong>{line.plan}</strong> {fill(words.fee, { fee: formatAmount(line.fee) })}
                </li>
              ))}
            </ul>
            {company.contract.moreFees && <span className="df-muted">{words.moreFees}</span>}
          </Fact>
          <Fact label={words.poweredBy}>{poweredByText(company.contract)}</Fact>
        </dl>
      ) : (
        <p className="df-muted">{words.noContract}</p>
      )}
    </section>
  </div>
)
