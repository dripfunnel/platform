-- Staff identity and sessions (DATA-MODEL.md §3.1). Company SSO only, so no password column.

create table staff_user (
  id uuid primary key default gen_random_uuid(),
  sso_subject text not null unique,
  email text not null,
  name text not null,
  role_key text not null check (
    role_key in (
      'staff-super-admin', 'staff-partner-manager', 'staff-support',
      'staff-finance', 'staff-engineer', 'staff-read-only'
    )
  ),
  status text not null check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now()
);

create table staff_session (
  id_hash text primary key,
  staff_user_id uuid not null references staff_user (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- The absolute bound. Idle is measured from last_seen_at (ACCESS.md §4).
  expires_at timestamptz not null,
  -- When the staff member last proved who they are, for the actions that need it afresh
  -- (CONSOLE-DESIGN A2).
  reauth_at timestamptz
);

create index staff_session_staff_user_id_idx on staff_session (staff_user_id);

-- Least privilege (DATA-MODEL.md §5.2): a request scope reads the staff directory and
-- nothing else. Sessions belong to `app_system`, which is the only scope that writes them.
grant select on staff_user to app_request, app_system;
grant select, insert, update, delete on staff_session to app_system;

alter table staff_user enable row level security;
alter table staff_session enable row level security;
alter table staff_user force row level security;
alter table staff_session force row level security;

-- The Admin API (§2), plus `system` for sign-in, which runs before a scope exists.
-- staff_session has neither grant nor policy here: a session hash is a credential.
create policy staff_user_read on staff_user for select
using (app_setting_text('app.scope') in ('platform', 'system'));

-- Sessions are written during sign-in, before any scope exists to authorise it, so `auth/`
-- creates and ends them as `app_system` rather than inventing a pre-authentication scope.
create policy staff_session_write on staff_session for all
using (app_setting_text('app.scope') = 'system')
with check (app_setting_text('app.scope') = 'system');

-- Staff records are created by #39's invite flow, not here.
