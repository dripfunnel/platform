import type { CustomerGroup } from '../../api/customers'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.customers.groups

export interface GroupsTabProps {
  groups: readonly CustomerGroup[]
  canEdit: boolean
  onSee: (group: CustomerGroup) => void
  onAdd: () => void
  onEdit: (group: CustomerGroup) => void
  onDelete: (group: CustomerGroup) => void
}

/** Customers › Groups (PortalOrders): each group with its members, "See people", and the team's edits. */
export const GroupsTab = ({ groups, canEdit, onSee, onAdd, onEdit, onDelete }: GroupsTabProps) => (
  <div className="df-customer-groups">
    <p className="df-customer-intro">{words.intro}</p>
    <ul className="df-customer-card df-customer-group-rows" aria-label={words.target}>
      {groups.map((g) => {
        const members = fill(plural(words.members, g.members), { count: formatCount(g.members) })
        return (
        <li key={g.id}>
          <span className="df-customer-group-name">
            <strong>{g.name}</strong>
            <span className="df-customer-sub">{g.description ? fill(words.membersWith, { members, description: g.description }) : members}</span>
          </span>
          <button type="button" className="df-link-button" onClick={() => onSee(g)}>
            {words.seePeople}
          </button>
          {canEdit && (
            <>
              <button type="button" className="df-button df-customer-small" onClick={() => onEdit(g)}>
                {words.edit}
              </button>
              <button type="button" className="df-button df-customer-small" onClick={() => onDelete(g)}>
                {words.delete}
              </button>
            </>
          )}
        </li>
        )
      })}
      {groups.length === 0 && <li className="df-customer-sub">{words.none}</li>}
    </ul>
    {canEdit && (
      <button type="button" className="df-button df-customer-add-group" onClick={onAdd}>
        {words.add}
      </button>
    )}
  </div>
)
