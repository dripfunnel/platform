-- #1328 step 5 (ACCESS.md §8): the merchant side's banner says support can make changes while it writes as a
-- new store's invited Owner. store_support_sessions (0160) also returns the seat's and its user's status and
-- whether the store has an active Owner or Manager, as the agent's own seat reads them (storeHasAllower).

grant select (store_id, status) on membership to app_definer;
grant select (status) on "user" to app_definer;

drop function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer);

create function store_support_sessions(open_at timestamptz, since timestamptz, after_at timestamptz, after_id uuid, before_at timestamptz, before_id uuid, lim integer)
returns table (
  id uuid, partner_name text, agent_id uuid, agent_name text, user_name text, role_key text, seller_name text,
  reason text, ticket text, started_at timestamptz, expires_at timestamptz, ended_at timestamptz,
  ended_by_partner_user_id uuid, ended_by_agent_name text, end_reason text, ended_by_user_name text,
  access text, write_requested_at timestamptz, write_request_note text, write_decided_at timestamptz, write_decided_by_name text,
  membership_status text, user_status text, store_has_allower boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Never a support session: other agents' reasons, tickets and requests are the merchant's (ACCESS.md §8).
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') <> '' then
    raise exception 'store_support_sessions: a person on the merchant side of the store only' using errcode = '42501';
  end if;
  return query
    select ss.id, p.name, ss.partner_user_id, pu.name, u.name, m.role_key, sl.name,
      ss.reason, ss.ticket, ss.started_at, ss.expires_at, ss.ended_at,
      ss.ended_by_partner_user_id, eb.name, ss.end_reason, ebu.name,
      ss.access, ss.write_requested_at, ss.write_request_note, ss.write_decided_at, d.name,
      m.status, u.status,
      exists (select 1 from membership am join "user" au on au.id = am.user_id
        where am.store_id = ss.store_id and am.seller_id is null and am.role_key in ('owner', 'manager')
          and am.status = 'active' and au.status = 'active')
    from support_session ss
    join partner p on p.id = ss.partner_id
    join partner_user pu on pu.id = ss.partner_user_id
    join membership m on m.id = ss.membership_id
    join "user" u on u.id = m.user_id
    left join seller sl on sl.id = m.seller_id
    left join partner_user eb on eb.id = ss.ended_by_partner_user_id
    left join "user" ebu on ebu.id = ss.ended_by_user_id
    left join "user" d on d.id = ss.write_decided_by_user_id
    where ss.store_id = app_setting_uuid('app.store_id') and ss.partner_id = app_setting_uuid('app.partner_id')
      and (open_at is null or (ss.ended_at is null and ss.expires_at > open_at))
      and (since is null or ss.started_at >= since)
      and (after_at is null or (ss.started_at, ss.id) < (after_at, after_id))
      and (before_at is null or (ss.started_at, ss.id) > (before_at, before_id))
    order by
      case when before_at is null then ss.started_at end desc, case when before_at is null then ss.id end desc,
      case when before_at is not null then ss.started_at end asc, case when before_at is not null then ss.id end asc
    limit lim;
end
$$;
alter function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) owner to app_definer;
revoke execute on function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public;
grant execute on function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to app_request;
