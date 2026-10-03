-- Partner users' sessions and their role (DATA-MODEL.md §3.2, §5.3; #155). Every partner-scope
-- request runs as app_partner from here on, so the partner branches leave app_request.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_partner') then
    create role app_partner nologin;
  end if;
end
$$;

-- As 0010 did for app_platform: the Worker's login may become it.
do $$
declare
  login text;
begin
  for login in
    select m.member::regrole::text from pg_auth_members m where m.roleid = 'app_request'::regrole
  loop
    execute format('grant app_partner to %s', login);
  end loop;
end
$$;

-- The same session model as staff_session (ACCESS.md §4), with `remember` for the longer
-- absolute bound #156's sign-in offers. The hash is a credential: app_system alone touches it.
create table partner_session (
  id_hash text primary key,
  partner_user_id uuid not null references partner_user (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  remember boolean not null default false
);

create index partner_session_partner_user_id_idx on partner_session (partner_user_id);

grant select, insert, update, delete on partner_session to app_system;
alter table partner_session enable row level security;
alter table partner_session force row level security;
create policy partner_session_write on partner_session for all to app_system
using (app_setting_text('app.scope') = 'system')
with check (app_setting_text('app.scope') = 'system');
create policy request_scope on partner_session as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop')) with check (app_setting_text('app.scope') in ('store', 'shop'));
create policy platform_scope on partner_session as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on partner_session as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- What the partner branches admit today (ACCESS.md §5.3): its own partner and team, its
-- stores at account level, and the credential columns withheld as from app_request (§2.1).
grant usage on schema public to app_partner;
-- By column (#214): what a partner edits of itself, and the state columns its own submission
-- writes; never is_house, kind, region, created_at. The trigger below holds the state columns.
grant select on partner to app_partner;
grant update (name, product_name, primary_color, accent_color, fallback_sender_accepted, state, submitted_at,
  submitted_by_kind, submitted_by_label, sent_back_reason, approved_at, paused_at, pause_reason) on partner to app_partner;
grant select, insert, update on store, partner_domain, partner_setup_item, plan to app_partner;
grant select on seller, custom_domain, job, membership to app_partner;
grant select, insert on activity_log to app_partner;
grant insert on outbox to app_partner;
-- Insert by column too: a partner adds a team member or an invitation, never a password, a
-- 2-factor secret, a lock or a token (those are sign-in's and the deliverer's, as app_system).
grant insert (id, partner_id, email, name, role_key, status, last_sign_in_at, created_at) on partner_user to app_partner;
grant insert (id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label, created_at) on partner_invitation to app_partner;
grant select (id, partner_id, email, name, role_key, status, last_sign_in_at, created_at),
      update (email, name, role_key, status, last_sign_in_at) on partner_user to app_partner;
grant select (id, partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label, accepted_at, revoked_at, created_at),
      update (expires_at, sent_at, accepted_at, revoked_at) on partner_invitation to app_partner;
grant select (id, partner_id, email, email_verified_at, name, status, last_sign_in_at, created_at) on "user" to app_partner;
-- The Stores list reads the owner's invitation state; which rows, the policy decides.
grant select (id, store_id, seller_id, email, role_key, expires_at, invited_by_user_id, invited_by_label, accepted_at, revoked_at, created_at) on invitation to app_partner;

-- The owner's invitation state on its own stores, for the Stores list and Resend invite
-- (ui/platform/FIRST-RELEASE.md §6.4); never a team member's or a supplier's invitation.
create policy invitation_partner_read on invitation for select to app_partner
using (
  app_setting_text('app.scope') = 'partner'
  and seller_id is null
  and role_key = 'owner'
  and store_id in (select id from store)
);

-- Every policy with a partner branch gains app_partner. app_request stays on those with a
-- platform branch until #210, for the Worker still live when this runs (as in 0010).
alter policy partner_read on partner to app_request, app_partner, app_platform;
alter policy partner_update on partner to app_request, app_partner, app_platform;
alter policy store_insert on store to app_request, app_partner, app_platform;
alter policy store_update on store to app_request, app_partner, app_platform;
alter policy store_read on store to app_request, app_partner, app_platform;
alter policy seller_read on seller to app_request, app_partner, app_platform, app_system;
alter policy activity_log_read on activity_log to app_request, app_partner, app_platform, app_system;
alter policy activity_log_insert on activity_log to app_request, app_partner, app_platform, app_system;
alter policy outbox_insert on outbox to app_request, app_partner, app_platform, app_system;
alter policy custom_domain_read on custom_domain to app_request, app_partner, app_platform, app_system;
alter policy job_read on job to app_request, app_partner, app_platform, app_system;
alter policy membership_read on membership to app_request, app_partner, app_platform, app_system;
alter policy user_read on "user" to app_request, app_partner, app_platform, app_system;

do $$
declare
  t text;
begin
  foreach t in array array['partner_user', 'partner_invitation', 'partner_domain', 'partner_setup_item', 'plan'] loop
    execute format('alter policy %I on %I to app_request, app_partner, app_platform, app_system', t || '_read', t);
    execute format('alter policy %I on %I to app_request, app_partner, app_platform, app_system', t || '_insert', t);
    execute format('alter policy %I on %I to app_request, app_partner, app_platform, app_system', t || '_update', t);
  end loop;

  -- The pins of 0010: app_request loses partner (no live Worker has a partner caller) and keeps
  -- platform until #210; app_partner gets partner.
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    if t <> 'partner_session' then
      execute format(
        'alter policy request_scope on %I
           using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''platform''))
           with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''platform''))', t);
    end if;
    execute format(
      'create policy partner_scope on %I as restrictive for all to app_partner
         using (app_setting_text(''app.scope'') = ''partner'')
         with check (app_setting_text(''app.scope'') = ''partner'')', t);
  end loop;
end
$$;

-- A partner moves itself only from Draft to Awaiting approval (SAAS §3.1); approval, pausing
-- and their facts are DripFunnel's (#214).
create function partner_self_update_guard() returns trigger
language plpgsql
as $$
begin
  if current_user = 'app_partner' and (
    (new.state is distinct from old.state and not (old.state = 'draft' and new.state = 'awaiting'))
    or new.approved_at is distinct from old.approved_at
    or new.paused_at is distinct from old.paused_at
    or new.pause_reason is distinct from old.pause_reason
  ) then
    raise exception 'partner: a partner may only submit itself for approval' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger partner_self_update_guard before update on partner
for each row execute function partner_self_update_guard();
