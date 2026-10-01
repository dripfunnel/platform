// States (?state=): loading, empty, error, readonly, nomatch. There is no denied state: every
// staff role may open Customers and none may act on one (decided on #42), so Read-only, which
// sees contacts masked, is the view to check. Without a state the screen shows the API's
// customers, newest first.
import { messages } from '../../messages'
import { ListHeader } from '../common/ListHeader'
import { ReadOnlyNotice } from '@dripfunnel/shared/ui'
import { CustomersList, type CustomersListProps } from './CustomersList'
import '../common/list.css'

const words = messages.customers

export type CustomersProps = Omit<CustomersListProps, 'store' | 'empty'> & { readOnly: boolean }

export const Customers = ({ readOnly, ...list }: CustomersProps) => (
  <div className="df-page df-list">
    {readOnly && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
    <ListHeader level={words.level} title={words.title} sub={words.sub} />
    <CustomersList {...list} empty={words.empty} />
  </div>
)
