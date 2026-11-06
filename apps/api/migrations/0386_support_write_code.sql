-- A support session's write code (ACCESS.md §8 "Write elevation"): beside Allow, an Owner or Manager may issue a
-- one-time code and read it to the agent, who types it on the portal host to make changes for that session.
-- Only its salted hash is kept; it's spent, replaced or voided after maxSmsCodeAttempts wrong tries.

alter table support_session
  add column write_code_hash text,
  add column write_code_expires_at timestamptz(3),
  add column write_code_attempts smallint not null default 0 check (write_code_attempts >= 0),
  add column write_code_issued_by_user_id uuid references "user" (id),
  add constraint support_session_write_code check (
    (write_code_hash is null) = (write_code_expires_at is null) and (write_code_hash is null) = (write_code_issued_by_user_id is null));

-- The agent redeems in system scope, by the session its cookie names (as requestSupportWrite, 0160).
grant select (write_code_hash, write_code_expires_at, write_code_attempts, write_code_issued_by_user_id),
  update (access, write_code_hash, write_code_expires_at, write_code_attempts, write_code_issued_by_user_id)
  on support_session to app_system;
grant select (write_code_expires_at), update (write_code_hash, write_code_expires_at, write_code_attempts, write_code_issued_by_user_id)
  on support_session to app_definer;

-- The merchant side issues one for an open, read-only session on the acting store; a new code replaces the last.
create function issue_support_write_code(session uuid, code_hash text, until timestamptz, at timestamptz)
returns table (expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform support_merchant_check('issue_support_write_code');
  return query
    update support_session ss
    set write_code_hash = code_hash, write_code_expires_at = least(until, ss.expires_at), write_code_attempts = 0,
        write_code_issued_by_user_id = app_setting_uuid('app.user_id')
    where ss.id = session and ss.store_id = app_setting_uuid('app.store_id') and ss.partner_id = app_setting_uuid('app.partner_id')
      and ss.ended_at is null and ss.expires_at > at and ss.access = 'read'
      and exists (select 1 from store s where s.id = ss.store_id and s.support_access_allowed and s.status not in ('cancelled', 'closed'))
    returning ss.write_code_expires_at;
end
$$;
alter function issue_support_write_code(uuid, text, timestamptz, timestamptz) owner to app_definer;
revoke execute on function issue_support_write_code(uuid, text, timestamptz, timestamptz) from public;
grant execute on function issue_support_write_code(uuid, text, timestamptz, timestamptz) to app_request;
