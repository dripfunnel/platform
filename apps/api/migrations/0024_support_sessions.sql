-- Partner support sessions (ACCESS.md §8, ui/platform/FIRST-RELEASE.md §12; #202): a partner user
-- acts as one of its merchants' users, read-only, for 30 minutes. The Store API's half (the
-- handoff exchange, the support caller, the merchant's Allow/Deny) is the Store strand's.

create table support_session (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner (id),
  store_id uuid not null references store (id),
  membership_id uuid not null references membership (id),
  partner_user_id uuid not null references partner_user (id),
  reason text not null check (char_length(reason) between 1 and 500),
  ticket text check (char_length(ticket) <= 500),
  started_at timestamptz(3) not null default now(),
  expires_at timestamptz(3) not null,
  ended_at timestamptz(3),
  ended_by_partner_user_id uuid references partner_user (id),
  -- The one-time handoff (ACCESS.md §8.3), as on partner_setup_session: hashed, spent on exchange.
  handoff_hash text unique,
  handoff_expires_at timestamptz(3),
  handoff_used_at timestamptz(3)
);

-- One open session per partner user, and one agent per merchant user at a time (§12.1).
create unique index support_session_agent_open_key on support_session (partner_user_id) where ended_at is null;
create unique index support_session_target_open_key on support_session (membership_id) where ended_at is null;
create index support_session_partner_idx on support_session (partner_id, started_at desc, id desc);
create index support_session_store_idx on support_session (store_id, started_at desc);

-- The handoff hash is a credential: the partner writes it and no request role reads it; the
-- Store strand's exchange gets its own grant.
grant select (id, partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, ended_at, ended_by_partner_user_id, handoff_expires_at, handoff_used_at),
  insert (partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at),
  update (ended_at, ended_by_partner_user_id, handoff_hash, handoff_expires_at, handoff_used_at) on support_session to app_partner;
grant select (id, partner_id, store_id, membership_id, partner_user_id, reason, ticket, started_at, expires_at, ended_at, ended_by_partner_user_id, handoff_expires_at, handoff_used_at) on support_session to app_platform;

alter table support_session enable row level security;
alter table support_session force row level security;
create policy request_scope on support_session as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on support_session as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on support_session as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on support_session as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_session_partner_read on support_session for select to app_partner
  using (partner_id = app_setting_uuid('app.partner_id'));
-- A session is the caller's own, on a user of one of its stores that allows partner support.
create policy support_session_partner_insert on support_session for insert to app_partner
  with check (
    partner_id = app_setting_uuid('app.partner_id')
    and partner_user_id = app_setting_uuid('app.user_id')
    and exists (
      select 1 from membership m join store s on s.id = m.store_id
      where m.id = membership_id and m.store_id = support_session.store_id
        and s.partner_id = app_setting_uuid('app.partner_id') and s.support_access_allowed
    )
  );
create policy support_session_partner_update on support_session for update to app_partner
  using (partner_id = app_setting_uuid('app.partner_id')) with check (partner_id = app_setting_uuid('app.partner_id'));
create policy support_session_staff on support_session for select to app_platform using (true);

-- Re-authentication (ACCESS.md §8: "re-authentication (A2)"): a 2-factor code buys one proof,
-- valid five minutes and spent by the start it allows. No request role reads or writes these.
alter table partner_user
  add column reauth_proof_hash text,
  add column reauth_proof_expires_at timestamptz(3);

-- Spends the caller's own proof; true once, then false. Owned by app_definer so app_partner
-- needs no grant on the columns.
create function spend_partner_reauth(proof_hash text, at timestamptz) returns boolean
language sql
security definer
set search_path = public
as $$
  with spent as (
    update partner_user set reauth_proof_hash = null, reauth_proof_expires_at = null
    where id = app_setting_uuid('app.user_id')
      and app_setting_text('app.scope') = 'partner'
      and reauth_proof_hash = proof_hash
      and reauth_proof_expires_at > at
    returning 1
  )
  select exists (select 1 from spent)
$$;

grant select (id, reauth_proof_hash, reauth_proof_expires_at), update (reauth_proof_hash, reauth_proof_expires_at) on partner_user to app_definer;
alter function spend_partner_reauth(text, timestamptz) owner to app_definer;
revoke execute on function spend_partner_reauth(text, timestamptz) from public;
grant execute on function spend_partner_reauth(text, timestamptz) to app_partner;
