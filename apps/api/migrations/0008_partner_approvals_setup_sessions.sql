-- Approving a partner needs two staff unless a Super admin ran its setup (ui/admin/FIRST-RELEASE.md
-- §4.3), and staff set a partner up through a setup session (ACCESS.md §8.2). Both are platform
-- scope: the Admin API alone, plus the portal's token exchange as a job.

create table partner_setup_session (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_user (id),
  partner_id uuid not null references partner (id),
  reason text not null check (char_length(reason) between 1 and 500),
  ticket text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_by_staff_id uuid references staff_user (id),
  -- The one-time handoff (ACCESS.md §8.3): hashed, short-lived, spent on exchange. The token
  -- itself exists only in the link the console opens.
  handoff_hash text unique,
  handoff_expires_at timestamptz,
  handoff_used_at timestamptz
);

-- One open setup session per staff member (ACCESS.md §8.2).
create unique index partner_setup_session_open_key on partner_setup_session (staff_user_id) where ended_at is null;
create index partner_setup_session_partner_idx on partner_setup_session (partner_id, started_at desc);

-- An approval is per submission: sending back and resubmitting starts the count again.
create table partner_approval (
  partner_id uuid not null references partner (id),
  staff_user_id uuid not null references staff_user (id),
  submitted_at timestamptz(3) not null,
  note text,
  approved_at timestamptz not null default now(),
  primary key (partner_id, staff_user_id, submitted_at)
);

-- The handoff hash is a credential (0007's rule): inserted and cleared by a request, read only
-- by the portal's exchange as app_system.
grant insert on partner_setup_session to app_request;
grant select (id, staff_user_id, partner_id, reason, ticket, started_at, expires_at, ended_at, ended_by_staff_id, handoff_expires_at, handoff_used_at),
      update (ended_at, ended_by_staff_id, handoff_hash, handoff_expires_at) on partner_setup_session to app_request;
grant select, update on partner_setup_session to app_system;
grant select, insert on partner_approval to app_request;

alter table partner_setup_session enable row level security;
alter table partner_approval enable row level security;
alter table partner_setup_session force row level security;
alter table partner_approval force row level security;

create policy partner_setup_session_read on partner_setup_session for select
using (app_setting_text('app.scope') in ('platform', 'system'));
create policy partner_setup_session_insert on partner_setup_session for insert
with check (app_setting_text('app.scope') = 'platform');
create policy partner_setup_session_update on partner_setup_session for update
using (app_setting_text('app.scope') in ('platform', 'system'))
with check (app_setting_text('app.scope') in ('platform', 'system'));

create policy partner_approval_read on partner_approval for select using (app_setting_text('app.scope') = 'platform');
create policy partner_approval_insert on partner_approval for insert with check (app_setting_text('app.scope') = 'platform');
