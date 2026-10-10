-- SAPI 21 (#331): the store's half of partner support sessions (ACCESS.md §8): the exchange on the
-- portal host, the merchant's Allow/Deny of writes, the On/Off switch ending open sessions, and the
-- store's Support access log. #202 (0024) made the session; nothing here changes how it starts.

alter table support_session
  add column access text not null default 'read' check (access in ('read', 'write')),
  -- The agent's one open request for writes, and the merchant's answer to it (ACCESS.md §8).
  add column write_requested_at timestamptz(3),
  add column write_request_note text check (char_length(write_request_note) between 1 and 500),
  add column write_decided_at timestamptz(3),
  add column write_decided_by_user_id uuid references "user" (id),
  -- The support cookie on the portal host, set when the handoff is spent (as impersonation's, 0030).
  add column portal_session_hash text unique,
  -- Ends the store side makes; a partner user's end keeps ended_by_partner_user_id, a run-out neither.
  add column end_reason text check (end_reason in ('support_off', 'target_gone', 'store_closed')),
  add column ended_by_user_id uuid references "user" (id),
  add constraint support_session_write_decided check (access = 'read' or write_decided_at is not null);

-- The partner console reads how a store ended a session (ui/platform/FIRST-RELEASE.md §12.3).
grant select (access, end_reason) on support_session to app_partner, app_platform;

-- The exchange and the support caller resolve in system scope, as every session does (ACCESS.md §4).
grant select (id, partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, ended_at,
    ended_by_partner_user_id, handoff_hash, handoff_expires_at, handoff_used_at, access, write_requested_at, write_request_note,
    write_decided_at, write_decided_by_user_id, portal_session_hash, end_reason, ended_by_user_id),
  update (ended_at, ended_by_partner_user_id, handoff_hash, handoff_used_at, portal_session_hash, end_reason,
    write_requested_at, write_request_note, write_decided_at, write_decided_by_user_id)
  on support_session to app_system;
create policy support_session_system on support_session for all to app_system using (true) with check (true);

-- The definer functions below read and write these, and nothing else; no request role reads the table.
grant select (id, partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, ended_at,
    ended_by_partner_user_id, access, write_requested_at, write_request_note, write_decided_at, write_decided_by_user_id, end_reason, ended_by_user_id),
  update (ended_at, handoff_hash, end_reason, ended_by_user_id, access, write_decided_at, write_decided_by_user_id)
  on support_session to app_definer;
grant select (id, partner_id, status, support_access_allowed) on store to app_definer;
grant update (support_access_allowed) on store to app_definer;
grant select (id, user_id, seller_id, role_key) on membership to app_definer;
grant select (id, name) on "user" to app_definer;
grant select (id, name) on seller to app_definer;

-- Who may act through these: a person on the merchant side of the acting store, never a support
-- session, a supplier or a shopper (ACCESS.md §8: a support session never decides its own access).
create function support_merchant_check(fn text) returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> ''
     or app_setting_text('app.support') <> '' or app_setting_text('app.user_id') = '' then
    raise exception '%: a person on the merchant side of the store only', fn using errcode = '42501';
  end if;
end
$$;
revoke execute on function support_merchant_check(text) from public;
grant execute on function support_merchant_check(text) to app_definer;

-- Settings › Support access: On or Off; Off ends every open session on the store at once (ACCESS.md §8).
create function set_store_support_access(allowed boolean, at timestamptz)
returns table (session_id uuid, membership_id uuid, partner_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform support_merchant_check('set_store_support_access');
  update store set support_access_allowed = allowed
  where id = app_setting_uuid('app.store_id') and partner_id = app_setting_uuid('app.partner_id');
  if allowed then
    return;
  end if;
  return query
    update support_session ss
    set ended_at = at, end_reason = 'support_off', ended_by_user_id = app_setting_uuid('app.user_id'), handoff_hash = null
    where ss.store_id = app_setting_uuid('app.store_id') and ss.partner_id = app_setting_uuid('app.partner_id')
      and ss.ended_at is null and ss.expires_at > at
    returning ss.id, ss.membership_id, ss.partner_user_id;
end
$$;
alter function set_store_support_access(boolean, timestamptz) owner to app_definer;
revoke execute on function set_store_support_access(boolean, timestamptz) from public;
grant execute on function set_store_support_access(boolean, timestamptz) to app_request;

-- Allow or Deny the agent's open request, on a session still open on a store still allowing support.
-- The update's row lock is what keeps an answer from crossing an end.
create function decide_support_write(session uuid, allow boolean, at timestamptz)
returns table (session_id uuid, membership_id uuid, partner_user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform support_merchant_check('decide_support_write');
  return query
    update support_session ss
    set access = case when allow then 'write' else ss.access end, write_decided_at = at,
        write_decided_by_user_id = app_setting_uuid('app.user_id')
    where ss.id = session and ss.store_id = app_setting_uuid('app.store_id') and ss.partner_id = app_setting_uuid('app.partner_id')
      and ss.ended_at is null and ss.expires_at > at
      and ss.write_requested_at is not null and ss.write_decided_at is null
      and exists (select 1 from store s where s.id = ss.store_id and s.support_access_allowed and s.status not in ('cancelled', 'closed'))
    returning ss.id, ss.membership_id, ss.partner_user_id;
end
$$;
alter function decide_support_write(uuid, boolean, timestamptz) owner to app_definer;
revoke execute on function decide_support_write(uuid, boolean, timestamptz) from public;
grant execute on function decide_support_write(uuid, boolean, timestamptz) to app_request;

-- The merchant side's view of support sessions on the acting store: the banner's open one and the
-- Support access log. The agent's and partner's names need no request grant on their tables.
create function store_support_sessions(open_at timestamptz, since timestamptz, after_at timestamptz, after_id uuid, before_at timestamptz, before_id uuid, lim integer)
returns table (
  id uuid, partner_name text, agent_id uuid, agent_name text, user_name text, role_key text, seller_name text,
  reason text, ticket text, started_at timestamptz, expires_at timestamptz, ended_at timestamptz,
  ended_by_partner_user_id uuid, ended_by_agent_name text, end_reason text, ended_by_user_name text,
  access text, write_requested_at timestamptz, write_request_note text, write_decided_at timestamptz, write_decided_by_name text
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
      ss.access, ss.write_requested_at, ss.write_request_note, ss.write_decided_at, d.name
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
grant select (id, name) on partner_user to app_definer;
grant select (id, name) on partner to app_definer;
alter function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) owner to app_definer;
revoke execute on function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) from public;
grant execute on function store_support_sessions(timestamptz, timestamptz, timestamptz, uuid, timestamptz, uuid, integer) to app_request;
