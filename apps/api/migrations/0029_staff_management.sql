-- Staff on the Admin API (ui/admin/FIRST-RELEASE.md §10; #39): invitations that bind the
-- invitee's SSO account on first sign-in, what the last sign-in reported, and removal that keeps
-- the row the log names.

-- An invited member has no SSO account until they accept; the unique index still holds.
alter table staff_user alter column sso_subject drop not null;
alter table staff_user
  add column last_sign_in_at timestamptz,
  -- Whether the company SSO reported a second factor at that sign-in (decided on #45).
  add column two_factor boolean;
alter table staff_user drop constraint staff_user_status_check;
alter table staff_user add constraint staff_user_status_check check (status in ('active', 'invited', 'suspended', 'removed'));
create index staff_user_email_idx on staff_user (lower(email));
create index staff_user_created_idx on staff_user (created_at, id);

-- One link per invitation: single use, 7 days, a resend makes a new row and revokes the old.
-- The token exists only in the email; its deliverer writes the hash, as for partner invitations.
create table staff_invitation (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references staff_user (id),
  token_hash text unique,
  sent_at timestamptz(3) not null,
  expires_at timestamptz(3) not null,
  accepted_at timestamptz(3),
  revoked_at timestamptz(3),
  invited_by_staff_id uuid not null references staff_user (id),
  created_at timestamptz(3) not null default now()
);

create index staff_invitation_user_idx on staff_invitation (staff_user_id, created_at desc);

-- Staff requests: the directory by column, never the token; sign-in and the deliverer, all of it.
grant insert (email, name, role_key, status), update (role_key, status) on staff_user to app_platform;
grant select (id, staff_user_id, sent_at, expires_at, accepted_at, revoked_at, invited_by_staff_id, created_at),
  insert (staff_user_id, sent_at, expires_at, invited_by_staff_id), update (revoked_at) on staff_invitation to app_platform;
grant select, update on staff_invitation to app_system;
grant update (sso_subject, name, status, last_sign_in_at, two_factor) on staff_user to app_system;

alter table staff_invitation enable row level security;
alter table staff_invitation force row level security;
create policy request_scope on staff_invitation as restrictive for all to app_request
  using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy partner_scope on staff_invitation as restrictive for all to app_partner
  using (app_setting_text('app.scope') = 'partner') with check (app_setting_text('app.scope') = 'partner');
create policy platform_scope on staff_invitation as restrictive for all to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on staff_invitation as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy staff_invitation_staff on staff_invitation for all to app_platform, app_system using (true) with check (true);

create policy staff_user_platform_write on staff_user for insert to app_platform
  with check (app_setting_text('app.scope') = 'platform' and status = 'invited');
create policy staff_user_platform_update on staff_user for update to app_platform
  using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy staff_user_system_update on staff_user for update to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- Removing a member ends their sessions at once; the hashes are app_system's alone (0004), so a
-- definer function does it for the Admin API, for one member and nothing else.
create function end_staff_user_sessions(p_staff uuid) returns integer
language sql security definer set search_path = public
as $$
  with ended as (delete from staff_session where staff_user_id = p_staff and app_setting_text('app.scope') = 'platform' returning 1)
  select count(*)::int from ended
$$;
grant delete, select on staff_session to app_definer;
alter function end_staff_user_sessions(uuid) owner to app_definer;
revoke all on function end_staff_user_sessions(uuid) from public;
grant execute on function end_staff_user_sessions(uuid) to app_platform;
