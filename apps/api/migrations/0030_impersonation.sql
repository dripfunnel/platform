-- Staff impersonation (ACCESS.md §8.1, DATA-MODEL.md §3.5; #40): a staff member acts as a partner
-- or store user, 30 minutes, extendable once. Platform scope: written and listed by the Admin API
-- only; the portal's exchange spends the handoff as app_system (#243).

create table impersonation (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_user (id),
  target_kind text not null check (target_kind in ('partner_user', 'person')),
  target_id uuid not null,
  -- The store membership acted through; null for a partner user (their partner is the place).
  membership_id uuid references membership (id),
  partner_id uuid not null references partner (id),
  store_id uuid references store (id),
  reason text not null check (char_length(reason) between 1 and 500),
  ticket text check (char_length(ticket) <= 500),
  started_at timestamptz(3) not null,
  expires_at timestamptz(3) not null,
  -- The single 30-minute extension is a fact about the row, so "once" is never counted from the log.
  extended_at timestamptz(3),
  ended_at timestamptz(3),
  ended_by uuid references staff_user (id),
  end_reason text check (end_reason in ('staff', 'expired', 'portal', 'target_gone', 'partner_closed')),
  handoff_hash text unique,
  handoff_expires_at timestamptz(3),
  handoff_used_at timestamptz(3),
  constraint impersonation_store_target check ((target_kind = 'person') = (membership_id is not null and store_id is not null)),
  constraint impersonation_ended check ((ended_at is null) = (end_reason is null))
);

-- One open impersonation per staff member (ACCESS.md §8.3, IMPERSONATION_ALREADY_OPEN).
create unique index impersonation_open_key on impersonation (staff_user_id) where ended_at is null;
create index impersonation_started_idx on impersonation (started_at desc, id desc);
create index impersonation_target_idx on impersonation (target_kind, target_id);

-- The handoff hash is a credential (0008's rule): the Admin API writes it, only the exchange reads it.
grant select (id, staff_user_id, target_kind, target_id, membership_id, partner_id, store_id, reason, ticket, started_at, expires_at,
             extended_at, ended_at, ended_by, end_reason, handoff_expires_at, handoff_used_at),
  insert (staff_user_id, target_kind, target_id, membership_id, partner_id, store_id, reason, ticket, started_at, expires_at, handoff_hash, handoff_expires_at),
  update (extended_at, expires_at, ended_at, ended_by, end_reason, handoff_hash, handoff_expires_at, handoff_used_at) on impersonation to app_platform;
grant select, update on impersonation to app_system;

alter table impersonation enable row level security;
alter table impersonation force row level security;
create policy request_scope on impersonation as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on impersonation as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on impersonation as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on impersonation as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
-- The staff member starts their own, and nobody else's.
create policy impersonation_staff_insert on impersonation for insert to app_platform
  with check (staff_user_id = app_setting_uuid('app.staff_id'));
create policy impersonation_staff on impersonation for select to app_platform using (true);
create policy impersonation_staff_update on impersonation for update to app_platform using (true) with check (true);
create policy impersonation_system on impersonation for all to app_system using (true) with check (true);

-- A setup session gets a fresh link on return, as an impersonation does (ACCESS.md §8.3).
grant update (handoff_used_at) on partner_setup_session to app_platform;
